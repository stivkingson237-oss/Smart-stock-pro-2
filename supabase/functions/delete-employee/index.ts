import { createClient } from "npm:@supabase/supabase-js@2";
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const token = (req.headers.get("Authorization") || "").replace("Bearer ", "");
    const { data: { user } } = await admin.auth.getUser(token);
    if (!user) return json({ ok: false, error: "Non connecté" }, 401);
    const { membership_id } = await req.json();
    const { data: m } = await admin.from("memberships").select("user_id, business_id, role").eq("id", membership_id).maybeSingle();
    if (!m || m.role === "owner") return json({ ok: false, error: "Introuvable" }, 404);
    const { data: own } = await admin.from("memberships").select("id").eq("business_id", m.business_id).eq("user_id", user.id).eq("role", "owner").maybeSingle();
    if (!own) return json({ ok: false, error: "Réservé au Patron" }, 403);
    const { error } = await admin.auth.admin.deleteUser(m.user_id);
    if (error) return json({ ok: false, error: error.message }, 500);
    return json({ ok: true });
  } catch (e) { return json({ ok: false, error: (e as Error).message }, 500); }
});