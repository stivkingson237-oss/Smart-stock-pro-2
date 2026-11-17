import { createClient } from "npm:@supabase/supabase-js@2";
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS", "Vary": "Origin" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ ok:false, error:"Méthode non autorisée" },405);
  try {
    const body = await req.json();
    const fullName = String(body.full_name || "").trim();
    const code = String(body.identification_code || "").trim().toUpperCase();
    const boutiqueCode = String(body.boutique_code || "").trim().toUpperCase();
    const password = String(body.password || "");
    if (!fullName || !code || !boutiqueCode || password.length < 6) return json({ok:false,error:"Informations invalides ou mot de passe trop court."},400);
    const { data: member, error: memberError } = await admin.from("memberships").select("id,user_id,business_id,boutique_id,role,full_name,identification_code").eq("identification_code",code).maybeSingle();
    if (memberError) throw memberError;
    if (!member || !member.user_id) return json({ok:false,error:"Code d’identification inconnu. Demandez confirmation à votre Patron."},404);
    if (String(member.full_name||"").trim().toLocaleLowerCase() !== fullName.toLocaleLowerCase()) return json({ok:false,error:"Le nom complet ne correspond pas au compte créé par le Patron."},403);
    const { data: boutique, error: boutiqueError } = await admin.from("boutiques").select("id,code").eq("id",member.boutique_id).eq("business_id",member.business_id).maybeSingle();
    if (boutiqueError) throw boutiqueError;
    if (!boutique || String(boutique.code||"").trim().toUpperCase() !== boutiqueCode) return json({ok:false,error:"Le code boutique ne correspond pas à votre affectation."},403);
    const { error: updateError } = await admin.auth.admin.updateUserById(member.user_id,{password});
    if (updateError) throw updateError;
    return json({ok:true,role:member.role});
  } catch (error) { return json({ok:false,error:(error as Error).message||"Erreur serveur"},500); }
});
