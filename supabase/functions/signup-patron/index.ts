import { createClient } from "npm:@supabase/supabase-js@2";
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS", "Vary": "Origin" };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false, autoRefreshToken: false } });
async function hash(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, "0")).join("");
}
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ ok: false, error: "Méthode non autorisée" }, 405);
  let userId: string | null = null;
  try {
    const raw = await req.text();
    if (raw.length > 16384) return json({ ok: false, error: "Requête trop volumineuse." }, 413);
    const b = JSON.parse(raw);
    const username = String(b.username || "").toLowerCase().replace(/[^a-z0-9._-]/g, "").slice(0, 64);
    const password = String(b.password || "");
    const entreprise = String(b.entreprise_name || "").trim();
    const boutique = String(b.boutique_name || "").trim();
    const fullName = String(b.full_name || "").trim();
    if (!username || password.length < 8 || password.length > 128 || !entreprise || entreprise.length > 120 || !boutique || boutique.length > 120 || fullName.length > 120) {
      return json({ ok: false, error: "Informations invalides. Mot de passe de 8 caractères minimum." }, 400);
    }
    const ip = req.headers.get("cf-connecting-ip") || req.headers.get("x-real-ip") || "unknown";
    const keyHash = await hash(ip + ":" + username);
    const { data: allowed, error: rateError } = await admin.rpc("check_patron_signup_rate_limit", { p_key_hash: keyHash });
    if (rateError) throw rateError;
    if (allowed !== true) return json({ ok: false, error: "Trop de tentatives. Réessayez dans 15 minutes." }, 429);
    const login_email = `${username}@smartstock-pro.internal`;
    const { data: u, error: ue } = await admin.auth.admin.createUser({ email: login_email, password, email_confirm: true,
      user_metadata: { full_name: fullName, telephone: String(b.telephone || "").slice(0, 32), email: b.email ?? null } });
    if (ue || !u.user) return json({ ok: false, error: /already|registered|exists/i.test(ue?.message || "") ? "Identifiant déjà utilisé" : "Création impossible" }, 409);
    userId = u.user.id;
    const { data: biz, error: e1 } = await admin.from("businesses").insert({ name: entreprise, devise: b.devise ?? "FCFA", pays: b.pays ?? null, owner_id: userId }).select("id").single();
    if (e1) throw e1;
    const letter = boutique.replace(/^Boutique\s*/i, "").charAt(0).toUpperCase() || "X";
    const { data: bt, error: e2 } = await admin.from("boutiques").insert({ business_id: biz.id, name: boutique, address: String(b.boutique_address || "").slice(0, 200) || null, code: `BT${letter}-1001` }).select("id").single();
    if (e2) throw e2;
    const { error: e3 } = await admin.from("memberships").insert({ business_id: biz.id, user_id: userId, role: "owner", full_name: fullName || username, identification_code: username });
    if (e3) throw e3;
    const { error: subError } = await admin.from("subscriptions").insert({ business_id: biz.id, plan_code: "FREE", status: "ACTIVE" });
    if (subError) throw subError;

    // Enregistrer le parrain uniquement si l'identifiant correspond à une entreprise existante.
    // L'identifiant vient du paramètre ?ref= du lien partagé ; il n'accorde aucun accès à cette entreprise.
    const referralId = String(b.referral_business_id || "").trim();
    const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (uuidPattern.test(referralId) && referralId !== biz.id) {
      const { data: referrer, error: referrerError } = await admin
        .from("businesses").select("id").eq("id", referralId).maybeSingle();
      if (referrerError) throw referrerError;
      if (referrer) {
        const { error: referralError } = await admin.from("owner_referrals").insert({
          referrer_business_id: referrer.id,
          referred_business_id: biz.id
        });
        if (referralError) throw referralError;
      }
    }

    return json({ ok: true, login_email, business_id: biz.id, boutique_id: bt.id });
  } catch (e) {
    if (userId) await admin.auth.admin.deleteUser(userId).catch(() => {});
    console.error("Erreur signup patron:", e);
    return json({ ok: false, error: "Impossible de créer le compte pour le moment." }, 500);
  }
});