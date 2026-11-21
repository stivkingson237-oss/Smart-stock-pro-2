import { createClient } from "npm:@supabase/supabase-js@2";
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS", "Vary": "Origin" };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
function initials(value: string, count: number): string {
  const words = String(value || "").normalize("NFD").replace(/[\\u0300-\\u036f]/g, "").toUpperCase().match(/[A-Z0-9]+/g) || [];
  return words.slice(0, count).map((word) => word[0]).join("").padEnd(count, "X").slice(0, count);
}
function randomLetters(): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  return alphabet[Math.floor(Math.random() * 26)] + alphabet[Math.floor(Math.random() * 26)];
}
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const token = (req.headers.get("Authorization") || "").replace("Bearer ", "");
    const { data: { user } } = await admin.auth.getUser(token);
    if (!user) return json({ ok: false, error: "Non connecté" }, 401);
    const b = await req.json();
    const { data: own } = await admin.from("memberships").select("id,full_name").eq("business_id", b.business_id).eq("user_id", user.id).eq("role", "owner").maybeSingle();
    if (!own) return json({ ok: false, error: "Réservé au Patron" }, 403);
    const role = String(b.role || "");
    if (!["gestionnaire", "vendeur", "caissier"].includes(role)) return json({ ok: false, error: "Rôle invalide" }, 400);
    const fullName = String(b.full_name || "").trim();
    if (fullName.length < 2 || fullName.length > 120) return json({ ok: false, error: "Nom complet invalide" }, 400);
    const { data: bt } = await admin.from("boutiques").select("id, code, name").eq("id", b.boutique_id).eq("business_id", b.business_id).maybeSingle();
    if (!bt) return json({ ok: false, error: "Boutique introuvable" }, 404);

    // Un code stable, partagé par tous les employés de la boutique.
    let boutiqueSyncCode = String(bt.code || "").trim().toUpperCase();
    if (!/^[A-Z0-9]{2,}-[0-9]{4}-[A-Z]{2}$/.test(boutiqueSyncCode)) {
      const words = String(own.full_name || user.email || "PT").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().match(/[A-Z0-9]+/g) || [];
      const patronInitials = words.slice(0, 2).map((w) => w[0]).join("").padEnd(2, "X");
      const storeInitial = (String(bt.name || "B").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().match(/[A-Z0-9]/) || ["B"])[0];
      for (let i = 0; i < 40; i++) {
        const bytes = crypto.getRandomValues(new Uint32Array(1));
        const number = 1111 + (bytes[0] % 8889);
        const letters = crypto.getRandomValues(new Uint8Array(2));
        const suffix = String.fromCharCode(65 + letters[0] % 26) + String.fromCharCode(65 + letters[1] % 26);
        const candidate = `${patronInitials}${storeInitial}-${number}-${suffix}`;
        const { data: duplicate } = await admin.from("boutiques").select("id").eq("code", candidate).neq("id", bt.id).maybeSingle();
        if (!duplicate) { boutiqueSyncCode = candidate; break; }
      }
      if (!boutiqueSyncCode) return json({ ok: false, error: "Impossible de générer le code boutique." }, 500);
      const { error: codeError } = await admin.from("boutiques").update({ code: boutiqueSyncCode }).eq("id", bt.id);
      if (codeError) throw codeError;
    }

    // Code personnel distinct : son suffixe identifie le rôle côté serveur.
    const roleLetters: Record<string, string> = { gestionnaire: "G", vendeur: "V", caissier: "C" };
    const roleLetter = roleLetters[role];
    let code = "";
    for (let i = 0; i < 40; i++) {
      const bytes = crypto.getRandomValues(new Uint32Array(1));
      const number = 1111 + (bytes[0] % 8889);
      const letter = String.fromCharCode(65 + crypto.getRandomValues(new Uint8Array(1))[0] % 26);
      const candidate = `${boutiqueSyncCode.split("-")[0]}-${number}-${roleLetter}${letter}`;
      const { data: ex } = await admin.from("memberships").select("id").eq("identification_code", candidate).maybeSingle();
      if (!ex) { code = candidate; break; }
    }
    if (!code) return json({ ok: false, error: "Code personnel indisponible, réessayez." }, 500);
    const suppliedPassword = typeof b.password === "string" && b.password.length >= 6 ? b.password : null;
    const password = suppliedPassword || crypto.randomUUID();
    const { data: u, error: ue } = await admin.auth.admin.createUser({ email: `${code.toLowerCase()}@smartstock-pro.internal`, password, email_confirm: true });
    if (ue || !u.user) return json({ ok: false, error: ue?.message || "Création impossible" }, 400);
    const { data: m, error: me } = await admin.from("memberships").insert({ business_id: b.business_id, user_id: u.user.id, boutique_id: b.boutique_id, role, full_name: fullName, identification_code: code }).select("id").single();
    if (me) { await admin.auth.admin.deleteUser(u.user.id); return json({ ok: false, error: me.message }, 500); }
    return json({ ok: true, membership_id: m.id, identification_code: code, boutique_sync_code: boutiqueSyncCode, temporary_password: suppliedPassword ? null : password });
  } catch (e) { return json({ ok: false, error: (e as Error).message }, 500); }
});