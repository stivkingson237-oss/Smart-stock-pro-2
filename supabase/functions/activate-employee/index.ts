import { createClient } from "npm:@supabase/supabase-js@2";
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS", "Vary": "Origin" };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false, autoRefreshToken: false } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ ok: false, error: "Méthode non autorisée" }, 405);
  try {
    const raw = await req.text();
    if (raw.length > 12_288) return json({ ok: false, error: "Requête trop volumineuse." }, 413);
    const body = JSON.parse(raw);
    const fullName = String(body.full_name || "").trim();
    const code = String(body.identification_code || "").trim().toUpperCase();
    const password = String(body.password || "");
    const action = String(body.action || "activate");
    if (!code || code.length > 80) return json({ ok: false, error: "Code d’identification invalide." }, 400);

    const ip = req.headers.get("cf-connecting-ip") || req.headers.get("x-real-ip") || null;
    const { data: rateAllowed, error: rateError } = await admin.rpc("check_employee_activation_rate_limit", { p_code: code, p_ip: ip });
    if (rateError) throw rateError;
    if (rateAllowed !== true) return json({ ok: false, error: "Trop de tentatives. Réessayez dans 15 minutes." }, 429);

    const { data: member, error: memberError } = await admin.from("memberships")
      .select("id,user_id,business_id,boutique_id,role,full_name,identification_code,password_activated_at,password_activation_claimed_at")
      .eq("identification_code", code).maybeSingle();
    if (memberError) throw memberError;
    if (!member || !member.user_id) {
      await admin.rpc("record_employee_activation_failure", { p_code: code, p_ip: ip });
      return json({ ok: false, error: "Code d’identification inconnu. Demandez confirmation à votre Patron." }, 404);
    }
    const { data: boutique, error: boutiqueError } = await admin.from("boutiques")
      .select("id,code,name").eq("id", member.boutique_id).eq("business_id", member.business_id).maybeSingle();
    if (boutiqueError) throw boutiqueError;
    if (!boutique) {
      await admin.rpc("record_employee_activation_failure", { p_code: code, p_ip: ip });
      return json({ ok: false, error: "Aucune boutique n’est associée à ce compte." }, 403);
    }
    if (action === "reset") {
      const authorization = req.headers.get("Authorization") || "";
      const token = authorization.match(/^Bearer\s+(.+)$/i)?.[1];
      if (!token) return json({ ok: false, error: "Connexion Patron requise." }, 401);
      const { data: authData, error: authError } = await admin.auth.getUser(token);
      if (authError || !authData.user) return json({ ok: false, error: "Session invalide." }, 401);
      const { data: owner, error: ownerError } = await admin.from("memberships").select("id")
        .eq("business_id", member.business_id).eq("user_id", authData.user.id).eq("role", "owner").maybeSingle();
      if (ownerError) throw ownerError;
      if (!owner) return json({ ok: false, error: "Réinitialisation réservée au Patron de cette entreprise." }, 403);
      if (password.length < 8 || password.length > 128) return json({ ok: false, error: "Le mot de passe doit contenir entre 8 et 128 caractères." }, 400);
      const { error: passwordError } = await admin.auth.admin.updateUserById(member.user_id, { password });
      if (passwordError) throw passwordError;
      const { error: markError } = await admin.from("memberships").update({ password_activated_at: member.password_activated_at || new Date().toISOString(), password_activation_claimed_at: null }).eq("id", member.id);
      if (markError) throw markError;
      try { await admin.rpc("clear_employee_activation_attempts", { p_code: code, p_ip: ip }); } catch (_e) {}
      return json({ ok: true, message: "Mot de passe réinitialisé." });
    }
    if (action === "lookup") return json({ ok: true, boutique_code: boutique.code });
    if (action !== "activate") return json({ ok: false, error: "Action inconnue." }, 400);
    if (!fullName || password.length < 8 || password.length > 128) {
      return json({ ok: false, error: "Nom complet ou mot de passe invalide (8 caractères minimum)." }, 400);
    }
    if (member.password_activated_at) return json({ ok: false, error: "Ce compte a déjà été activé. Connectez-vous avec votre mot de passe." }, 409);
    if (String(member.full_name || "").trim().toLocaleLowerCase() !== fullName.toLocaleLowerCase()) {
      await admin.rpc("record_employee_activation_failure", { p_code: code, p_ip: ip });
      return json({ ok: false, error: "Le nom complet ne correspond pas au compte créé par le Patron." }, 403);
    }
    const staleBefore = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const claim = await admin.from("memberships").update({ password_activation_claimed_at: new Date().toISOString() })
      .eq("id", member.id).is("password_activated_at", null)
      .or("password_activation_claimed_at.is.null,password_activation_claimed_at.lt." + staleBefore).select("id").maybeSingle();
    if (claim.error) throw claim.error;
    if (!claim.data) return json({ ok: false, error: "Activation déjà en cours. Réessayez dans quelques minutes." }, 409);
    const { error: updateError } = await admin.auth.admin.updateUserById(member.user_id, { password });
    if (updateError) {
      await admin.from("memberships").update({ password_activation_claimed_at: null }).eq("id", member.id);
      throw updateError;
    }
    const marked = await admin.from("memberships").update({ password_activated_at: new Date().toISOString(), password_activation_claimed_at: null })
      .eq("id", member.id).is("password_activated_at", null).select("id").maybeSingle();
    if (marked.error || !marked.data) {
      await admin.from("memberships").update({ password_activation_claimed_at: null }).eq("id", member.id);
      throw marked.error || new Error("Impossible de confirmer l’activation du compte.");
    }
    try { await admin.rpc("clear_employee_activation_attempts", { p_code: code, p_ip: ip }); } catch (_e) {}
    return json({ ok: true, role: member.role, boutique_code: boutique.code, boutique_name: boutique.name });
  } catch (e) { console.error("Erreur activation employé:", e); return json({ ok: false, error: "Erreur serveur." }, 500); }
});