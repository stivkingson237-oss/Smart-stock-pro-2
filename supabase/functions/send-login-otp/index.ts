import { createClient } from "npm:@supabase/supabase-js@2";
const cors = { "Access-Control-Allow-Origin":"*", "Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods":"POST, OPTIONS" };
const json=(b:unknown,s=200)=>new Response(JSON.stringify(b),{status:s,headers:{...cors,"Content-Type":"application/json"}});
const admin=createClient(Deno.env.get("SUPABASE_URL")!,Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,{auth:{persistSession:false}});
const anon=createClient(Deno.env.get("SUPABASE_URL")!,Deno.env.get("SUPABASE_ANON_KEY")!,{auth:{persistSession:false}});
const hex=(b:ArrayBuffer)=>Array.from(new Uint8Array(b)).map(x=>x.toString(16).padStart(2,"0")).join("");
const hash=async(v:string)=>hex(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(v)));
const code=()=>String(crypto.getRandomValues(new Uint32Array(1))[0]%1000000).padStart(6,"0");
async function sendEmail(to:string,otp:string){
 const key=Deno.env.get("RESEND_API_KEY"), from=Deno.env.get("OTP_EMAIL_FROM");
 if(!key||!from) throw new Error("Service e-mail non configuré.");
 const r=await fetch("https://api.resend.com/emails",{method:"POST",headers:{"Authorization":"Bearer "+key,"Content-Type":"application/json"},body:JSON.stringify({from,to,subject:"Votre code Smart Stock Pro",html:`<div style="font-family:Arial,sans-serif"><h2>Vérification Smart Stock Pro</h2><p>Votre code de vérification est :</p><p style="font-size:32px;font-weight:bold;letter-spacing:8px">${otp}</p><p>Ce code expire dans 5 minutes. Ne le partagez avec personne.</p></div>`})});
 if(!r.ok) throw new Error("Envoi de l’e-mail impossible.");
}
Deno.serve(async(req)=>{
 if(req.method==="OPTIONS") return new Response("ok",{headers:cors});
 if(req.method!=="POST") return json({ok:false,error:"Méthode non autorisée"},405);
 try{
  const b=await req.json(), username=String(b.username||"").toLowerCase().replace(/[^a-z0-9._-]/g,""), password=String(b.password||""), role=String(b.role||"");
  if(!username||!password||!["admin","gestionnaire","vendeur","caissier"].includes(role)) return json({ok:false,error:"Identifiants invalides."},400);
  const emailLogin=username+"@smartstock-pro.internal";
  const auth=await anon.auth.signInWithPassword({email:emailLogin,password});
  if(auth.error||!auth.data.user) return json({ok:false,error:"Identifiant ou mot de passe incorrect."},401);
  const user=auth.data.user;
  const {data:m,error:me}=await admin.from("memberships").select("id,business_id,role").eq("user_id",user.id).maybeSingle();
  if(me) throw me;
  if(!m) return json({ok:false,error:"Profil Smart Stock Pro introuvable."},404);
  const expected=role==="admin"?"owner":role;
  if(m.role!==expected) return json({ok:false,error:"Rôle non autorisé pour ce compte."},403);
  const {data:biz,error:be}=await admin.from("businesses").select("email").eq("id",m.business_id).maybeSingle();
  if(be) throw be;
  const isOwner=m.role==="owner";
  const contactEmail=String((isOwner?biz?.email:"")||user.user_metadata?.contact_email||user.user_metadata?.email||(isOwner?biz?.email:"")||"").trim();
  if(!contactEmail||!/^\S+@\S+\.\S+$/.test(contactEmail)) return json({ok:false,error:"Une adresse e-mail valide doit être enregistrée pour ce compte."},422);
  if(!/^\+[1-9]\d{7,14}$/.test(normalizedPhone)) return json({ok:false,error:"Un numéro de téléphone au format international (+237...) doit être enregistré pour ce compte."},422);
  const {data:recent}=await admin.from("login_otp_challenges").select("created_at").eq("user_id",user.id).order("created_at",{ascending:false}).limit(1).maybeSingle();
  if(recent && Date.now()-new Date(recent.created_at).getTime()<60000) return json({ok:false,error:"Patientez une minute avant de demander un nouveau code."},429);
  const emailOtp=code(),challengeId=crypto.randomUUID(),expires=new Date(Date.now()+5*60*1000).toISOString();
  const {error:del}=await admin.from("login_otp_challenges").delete().eq("user_id",user.id).is("consumed_at",null);
  if(del) throw del;
  const {error:ins}=await admin.from("login_otp_challenges").insert({id:challengeId,user_id:user.id,email_code_hash:await hash(challengeId+":"+user.id+":email:"+emailOtp),expires_at:expires});
  if(ins) throw ins;
  await sendEmail(contactEmail,emailOtp);
  return json({ok:true,message:"Code envoyé par e-mail.",email_hint:contactEmail.replace(/^(.).+(@.+)$/,"$1•••$2")});
 }catch(e){console.error(e);return json({ok:false,error:(e as Error).message||"Erreur d’envoi des codes."},500);}
});