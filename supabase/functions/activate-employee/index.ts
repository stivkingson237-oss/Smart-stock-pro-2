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
    if (fullName.length < 2 || fullName.length > 120) return json({ok:false,error:"Le nom complet doit contenir entre 2 et 120 caractères."},400);
    if (code.length < 6 || code.length > 40 || boutiqueSyncCode.length < 6 || boutiqueSyncCode.length > 40) return json({ok:false,error:"Format du code personnel ou du code boutique invalide."},400);
    const { data: member, error: memberError } = await admin.from("memberships").select("id,user_id,business_id,boutique_id,role,full_name,identification_code,password_activated_at").eq("identification_code",code).maybeSingle();
    if (memberError) return json({ok:false,error:"Impossible de vérifier le code personnel dans la base : "+memberError.message},500);
    if (!member || !member.user_id) return json({ok:false,error:"Code personnel inconnu. Vérifiez qu'il a bien été créé par le Patron."},404);
    if (member.password_activated_at) return json({ok:false,error:"Ce compte est déjà activé. Utilisez directement la connexion avec votre code personnel et votre mot de passe."},409);
    if (!["gestionnaire","vendeur","caissier"].includes(String(member.role))) return json({ok:false,error:"Le rôle enregistré pour ce compte est invalide. Le Patron doit corriger le profil."},409);
    if (String(member.full_name||"").trim().toLocaleLowerCase() !== fullName.toLocaleLowerCase()) return json({ok:false,error:"Le nom complet ne correspond pas au compte créé par le Patron."},403);
    const { data: boutique, error: boutiqueError } = await admin.from("boutiques").select("id,code,name").eq("id",member.boutique_id).eq("business_id",member.business_id).maybeSingle();
    if (boutiqueError) throw boutiqueError;
    if (!boutique) return json({ok:false,error:"Aucune boutique n’est associée à ce compte. Demandez au Patron de vérifier votre affectation."},403);
    if (String(boutique.code || "").trim().toUpperCase() !== boutiqueSyncCode) return json({ok:false,error:"Le code de synchronisation ne correspond pas à la boutique de votre compte."},403);
    // Réserver l'activation avec une mise à jour conditionnelle : une seule requête
    // concurrente peut consommer ce code personnel.
    const activatedAt = new Date().toISOString();
    const { data: claimed, error: claimError } = await admin.from("memberships").update({password_activated_at:activatedAt}).eq("id",member.id).is("password_activated_at",null).select("id").maybeSingle();
    if (claimError) return json({ok:false,error:"Impossible d'enregistrer l'activation : "+claimError.message},500);
    if (!claimed) return json({ok:false,error:"Ce compte vient d'être activé. Connectez-vous avec votre mot de passe personnel."},409);
    const { error: updateError } = await admin.auth.admin.updateUserById(member.user_id,{password});
    if (updateError) {
      await admin.from("memberships").update({password_activated_at:null}).eq("id",member.id).eq("password_activated_at",activatedAt);
      return json({ok:false,error:"Le mot de passe Supabase n'a pas pu être enregistré : "+updateError.message},500);
    }
    return json({ok:true,role:member.role,boutique_code:boutique.code,boutique_name:boutique.name});
  } catch (error) { return json({ok:false,error:(error as Error).message||"Erreur serveur"},500); }
});
