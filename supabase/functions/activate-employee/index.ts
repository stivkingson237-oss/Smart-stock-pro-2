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
    const boutiqueSyncCode = String(body.boutique_sync_code || "").trim().toUpperCase();
    const password = String(body.password || "");
    if (!fullName || !code || !boutiqueSyncCode || password.length < 6) return json({ok:false,error:"Nom, code d’identification ou mot de passe invalide."},400);
    const { data: member, error: memberError } = await admin.from("memberships").select("id,user_id,business_id,boutique_id,role,full_name,identification_code,password_activated_at").eq("identification_code",code).maybeSingle();
    if (memberError) throw memberError;
    if (!member || !member.user_id) return json({ok:false,error:"Code d’identification inconnu. Demandez confirmation à votre Patron."},404);
    if (member.password_activated_at) return json({ok:false,error:"Ce compte a déjà été activé. Connectez-vous avec votre mot de passe personnel."},409);
    if (String(member.full_name||"").trim().toLocaleLowerCase() !== fullName.toLocaleLowerCase()) return json({ok:false,error:"Le nom complet ne correspond pas au compte créé par le Patron."},403);
    const { data: boutique, error: boutiqueError } = await admin.from("boutiques").select("id,code,name").eq("id",member.boutique_id).eq("business_id",member.business_id).maybeSingle();
    if (boutiqueError) throw boutiqueError;
    if (!boutique) return json({ok:false,error:"Aucune boutique n’est associée à ce compte. Demandez au Patron de vérifier votre affectation."},403);
    if (String(boutique.code || "").trim().toUpperCase() !== boutiqueSyncCode) return json({ok:false,error:"Le code de synchronisation ne correspond pas à la boutique de votre compte."},403);
    const { error: updateError } = await admin.auth.admin.updateUserById(member.user_id,{password});
    if (updateError) throw updateError;
    const { error: markError } = await admin.from("memberships").update({password_activated_at:new Date().toISOString()}).eq("id",member.id).is("password_activated_at",null);
    if (markError) throw markError;
    return json({ok:true,role:member.role,boutique_code:boutique.code,boutique_name:boutique.name});
  } catch (error) { return json({ok:false,error:(error as Error).message||"Erreur serveur"},500); }
});
