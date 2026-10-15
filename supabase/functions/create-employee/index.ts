import { createClient } from "npm:@supabase/supabase-js@2";
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const LETTER: Record<string, string> = { gestionnaire: "G", vendeur: "V", caissier: "C" };
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const token = (req.headers.get("Authorization") || "").replace("Bearer ", "");
    const { data: { user } } = await admin.auth.getUser(token);
    if (!user) return json({ ok: false, error: "Non connecté" }, 401);
    const b = await req.json();
    const { data: own } = await admin.from("memberships").select("id").eq("business_id", b.business_id).eq("user_id", user.id).eq("role", "owner").maybeSingle();
    if (!own) return json({ ok: false, error: "Réservé au Patron" }, 403);
    if (!LETTER[b.role]) return json({ ok: false, error: "Rôle invalide" }, 400);
    const { data: bt } = await admin.from("boutiques").select("id, code").eq("id", b.boutique_id).eq("business_id", b.business_id).maybeSingle();
    if (!bt) return json({ ok: false, error: "Boutique introuvable" }, 404);
    const prefix = String(bt.code || "BT").split("-")[0];
    let code = "";
    for (let i = 0; i < 30; i++) {
      const c = `${prefix}-${1001 + Math.floor(Math.random() * 8999)}-${LETTER[b.role]}${String.fromCharCode(65 + Math.floor(Math.random() * 26))}`;
      const { data: ex } = await admin.from("memberships").select("id").eq("identification_code", c).maybeSingle();
      if (!ex) { code = c; break; }
    }
    if (!code) return json({ ok: false, error: "Code indisponible, réessayez" }, 500);
    const password = b.password && String(b.password).length >= 6 ? String(b.password) : crypto.randomUUID().slice(0, 12);
    const { data: u, error: ue } = await admin.auth.admin.createUser({ email: `${code.toLowerCase()}@smartstock-pro.internal`, password, email_confirm: true });
    if (ue || !u.user) return json({ ok: false, error: ue?.message || "Création impossible" }, 400);
    const { data: m, error: me } = await admin.from("memberships").insert({ business_id: b.business_id, user_id: u.user.id, boutique_id: b.boutique_id, role: b.role, full_name: b.full_name, identification_code: code }).select("id").single();
    if (me) { await admin.auth.admin.deleteUser(u.user.id); return json({ ok: false, error: me.message }, 500); }
    return json({ ok: true, membership_id: m.id, identification_code: code });
  } catch (e) { return json({ ok: false, error: (e as Error).message }, 500); }
});