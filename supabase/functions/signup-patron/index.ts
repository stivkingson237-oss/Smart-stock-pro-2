import { createClient } from "npm:@supabase/supabase-js@2";
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  let userId: string | null = null;
  try {
    const b = await req.json();
    const username = String(b.username || "").toLowerCase().replace(/[^a-z0-9._-]/g, "");
    const password = String(b.password || "");
    if (!username || password.length < 6 || !b.entreprise_name || !b.boutique_name) return json({ ok: false, error: "Champs requis manquants" }, 400);
    const login_email = `${username}@smartstock-pro.internal`;
    const { data: u, error: ue } = await admin.auth.admin.createUser({ email: login_email, password, email_confirm: true,
      user_metadata: { full_name: b.full_name, telephone: b.telephone, email: b.email ?? null } });
    if (ue || !u.user) return json({ ok: false, error: /already|registered|exists/i.test(ue?.message || "") ? "Identifiant déjà utilisé" : (ue?.message || "Création impossible") }, 409);
    userId = u.user.id;
    const { data: biz, error: e1 } = await admin.from("businesses").insert({ name: b.entreprise_name, devise: b.devise ?? "FCFA", pays: b.pays ?? null, owner_id: userId }).select("id").single();
    if (e1) throw e1;
    const letter = String(b.boutique_name).trim().replace(/^Boutique\s*/i, "").charAt(0).toUpperCase() || "X";
    const { data: bt, error: e2 } = await admin.from("boutiques").insert({ business_id: biz.id, name: b.boutique_name, address: b.boutique_address ?? null, code: `BT${letter}-1001` }).select("id").single();
    if (e2) throw e2;
    const { error: e3 } = await admin.from("memberships").insert({ business_id: biz.id, user_id: userId, role: "owner", full_name: b.full_name ?? username, identification_code: username });
    if (e3) throw e3;
    await admin.from("subscriptions").insert({ business_id: biz.id, plan_code: "FREE", status: "ACTIVE" });
    return json({ ok: true, login_email, business_id: biz.id, boutique_id: bt.id });
  } catch (e) {
    if (userId) await admin.auth.admin.deleteUser(userId).catch(() => {});
    return json({ ok: false, error: (e as Error).message || "Erreur serveur" }, 500);
  }
});