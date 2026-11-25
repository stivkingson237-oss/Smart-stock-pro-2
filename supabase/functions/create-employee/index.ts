import { createClient } from "npm:@supabase/supabase-js@2";
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS", "Vary": "Origin" };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false, autoRefreshToken: false } });
const LETTER: Record<string, string> = { gestionnaire: "G", vendeur: "V", caissier: "C" };
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ ok: false, error: "Méthode non autorisée" }, 405);
  try {
    const authorization = req.headers.get("Authorization") || "";
    const token = authorization.match(/^Bearer\s+(.+)$/i)?.[1];
    if (!token) return json({ ok: false, error: "Non connecté" }, 401);
    const { data: { user }, error: authError } = await admin.auth.getUser(token);
    if (authError || !user) return json({ ok: false, error: "Session invalide" }, 401);
    const raw = await req.text();
    if (raw.length > 16_384) return json({ ok: false, error: "Requête trop volumineuse." }, 413);
    const b = JSON.parse(raw);
    const businessId = String(b.business_id || "");
    const boutiqueId = String(b.boutique_id || "");
    const fullName = String(b.full_name || "").trim();
    if (!/^[0-9a-f-]{36}$/i.test(businessId) || !/^[0-9a-f-]{36}$/i.test(boutiqueId) || !fullName || fullName.length > 120) {
      return json({ ok: false, error: "Informations employé invalides." }, 400);
    }
    const { data: own } = await admin.from("memberships").select("id").eq("business_id", businessId).eq("user_id", user.id).eq("role", "owner").maybeSingle();
    if (!own) return json({ ok: false, error: "Réservé au Patron" }, 403);
    if (!LETTER[b.role]) return json({ ok: false, error: "Rôle invalide" }, 400);
    const { data: bt } = await admin.from("boutiques").select("id, code").eq("id", boutiqueId).eq("business_id", businessId).maybeSingle();
    if (!bt) return json({ ok: false, error: "Boutique introuvable" }, 404);
    const prefix = String(bt.code || "BT").split("-")[0];
    let code = "";
    for (let i = 0; i < 30; i++) {
      const random = new Uint32Array(1); crypto.getRandomValues(random);
      const c = `${prefix}-${1001 + (random[0] % 8999)}-${LETTER[b.role]}${String.fromCharCode(65 + ((random[0] >>> 8) % 26))}`;
      const { data: ex } = await admin.from("memberships").select("id").eq("identification_code", c).maybeSingle();
      if (!ex) { code = c; break; }
    }
    if (!code) return json({ ok: false, error: "Code indisponible, réessayez" }, 500);
    const suppliedPassword = b.password == null ? "" : String(b.password);
    if (suppliedPassword && (suppliedPassword.length < 8 || suppliedPassword.length > 128)) {
      return json({ ok: false, error: "Le mot de passe doit contenir entre 8 et 128 caractères." }, 400);
    }
    const password = suppliedPassword || crypto.randomUUID() + "aA1!";
    const { data: u, error: ue } = await admin.auth.admin.createUser({ email: `${code.toLowerCase()}@smartstock-pro.internal`, password, email_confirm: true });
    if (ue || !u.user) return json({ ok: false, error: "Création du compte employé impossible." }, 400);
    const { data: m, error: me } = await admin.from("memberships").insert({ business_id: businessId, user_id: u.user.id, boutique_id: boutiqueId, role: b.role, full_name: fullName, identification_code: code }).select("id").single();
    if (me) { await admin.auth.admin.deleteUser(u.user.id); return json({ ok: false, error: "Enregistrement de l'employé impossible." }, 500); }
    return json({ ok: true, membership_id: m.id, identification_code: code });
  } catch (e) { console.error("Erreur create employee:", e); return json({ ok: false, error: "Erreur serveur." }, 500); }
});