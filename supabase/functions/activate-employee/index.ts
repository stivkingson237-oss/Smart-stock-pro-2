import { createClient } from "npm:@supabase/supabase-js@2";
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ ok: false, error: "Méthode non autorisée" }, 405);
  try {
    const body = await req.json();
    const fullName = String(body.full_name || "").trim();
    const code = String(body.identification_code || "").trim().toUpperCase();
    const password = String(body.password || "");
    const action = String(body.action || "activate");
    if (!code || code.length > 80) return json({ ok: false, error: "Code d’identification invalide." }, 400);

    const ip = (req.headers.get("cf-connecting-ip") || req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || null;
    const { data: rateAllowed, error: rateError } = await admin.rpc("check_employee_activation_rate_limit", { p_code: code, p_ip: ip });
    if (rateError) throw rateError;
    if (rateAllowed !== true) return json({ ok: false, error: "Trop de tentatives. Réessayez dans 15 minutes." }, 429);

    const { data: member, error: memberError } = await admin.from("memberships")
      .select("id,user_id,business_id,boutique_id,role,full_name,identification_code,password_activated_at,password_activation_claimed_at")
      .eq("identification_code", code)
      .maybeSingle();
    if (memberError) throw memberError;
    if (!member || !member.user_id) {
      await admin.rpc("record_employee_activation_failure", { p_code: code, p_ip: ip });
      return json({ ok: false, error: "Code d’identification inconnu. Demandez confirmation à votre Patron." }, 404);
    }

    const { data: boutique, error: boutiqueError } = await admin.from("boutiques")
      .select("id,code,name")
      .eq("id", member.boutique_id)
      .eq("business_id", member.business_id)
      .maybeSingle();
    if (boutiqueError) throw boutiqueError;
    if (!boutique) {
      await admin.rpc("record_employee_activation_failure", { p_code: code, p_ip: ip });
      return json({ ok: false, error: "Aucune boutique n’est associée à ce compte." }, 403);
    }

    if (action === "lookup") {
      return json({ ok: true, boutique_code: boutique.code });
    }
    if (action !== "activate") return json({ ok: false, error: "Action inconnue." }, 400);
    if (!fullName || password.length < 6 || password.length > 128) {
      return json({ ok: false, error: "Nom complet ou mot de passe invalide (6 caractères minimum)." }, 400);
    }
    if (member.password_activated_at) {
      return json({ ok: false, error: "Ce compte a déjà été activé. Connectez-vous avec votre mot de passe." }, 409);
    }
    if (String(member.full_name || "").trim().toLocaleLowerCase() !== fullName.toLocaleLowerCase()) {
      await admin.rpc("record_employee_activation_failure", { p_code: code, p_ip: ip });
      return json({ ok: false, error: "Le nom complet ne correspond pas au compte créé par le Patron." }, 403);
    }

    const staleBefore = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const claim = await admin.from("memberships")
      .update({ password_activation_claimed_at: new Date().toISOString() })
      .eq("id", member.id)
      .is("password_activated_at", null)
      .or("password_activation_claimed_at.is.null,password_activation_claimed_at.lt." + staleBefore)
      .select("id")
      .maybeSingle();
    if (claim.error) throw claim.error;
    if (!claim.data) {
      return json({ ok: false, error: "Activation déjà en cours. Réessayez dans quelques minutes." }, 409);
    }

    const { error: updateError } = await admin.auth.admin.updateUserById(member.user_id, { password });
    if (updateError) {
      await admin.from("memberships").update({ password_activation_claimed_at: null }).eq("id", member.id);
      throw updateError;
    }
    const marked = await admin.from("memberships")
      .update({ password_activated_at: new Date().toISOString(), password_activation_claimed_at: null })
      .eq("id", member.id)
      .is("password_activated_at", null)
      .select("id")
      .maybeSingle();
    if (marked.error || !marked.data) {
      await admin.from("memberships").update({ password_activation_claimed_at: null }).eq("id", member.id);
      throw marked.error || new Error("Impossible de confirmer l’activation du compte.");
    }

    try { await admin.rpc("clear_employee_activation_attempts", { p_code: code, p_ip: ip }); } catch (_e) {}
    return json({ ok: true, role: member.role, boutique_code: boutique.code, boutique_name: boutique.name });
  } catch (e) {
    return json({ ok: false, error: (e as Error).message }, 500);
  }
});
