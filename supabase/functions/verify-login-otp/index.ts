import { createClient } from "npm:@supabase/supabase-js@2";
const cors={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type","Access-Control-Allow-Methods":"POST, OPTIONS"};
const json=(b:unknown,s=200)=>new Response(JSON.stringify(b),{status:s,headers:{...cors,"Content-Type":"application/json"}});
const admin=createClient(Deno.env.get("SUPABASE_URL")!,Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,{auth:{persistSession:false}});
const hash=async(v:string)=>Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(v)))).map(x=>x.toString(16).padStart(2,"0")).join("");
Deno.serve(async(req)=>{
 if(req.method==="OPTIONS") return new Response("ok",{headers:cors});
 if(req.method!=="POST") return json({ok:false,error:"Méthode non autorisée"},405);
 try{
  const b=await req.json(), username=String(b.username||"").toLowerCase().replace(/[^a-z0-9._-]/g,""), emailCode=String(b.email_code||"");
  if(!username||!/^\d{6}$/.test(emailCode)||!/^\d{6}$/.test(smsCode)) return json({ok:false,error:"Saisissez le code e-mail à six chiffres."},400);
  const {data:member,error:memberError}=await admin.from("memberships").select("user_id").in("identification_code",[username,username.toUpperCase()]).maybeSingle();
  if(memberError) throw memberError;
  if(!member?.user_id) return json({ok:false,error:"Vérification impossible."},400);
  const userId=member.user_id;
  const {data:c,error}=await admin.from("login_otp_challenges").select("*").eq("user_id",userId).is("consumed_at",null).order("created_at",{ascending:false}).limit(1).maybeSingle();
  if(error) throw error;
  if(!c||c.verified_at||new Date(c.expires_at).getTime()<Date.now()) return json({ok:false,error:"Codes expirés. Demandez un nouvel envoi."},400);
  if(c.attempts>=5) return json({ok:false,error:"Trop de tentatives. Demandez de nouveaux codes."},429);
  const eh=await hash(c.id+":"+userId+":email:"+emailCode);
  if(eh!==c.email_code_hash){
    await admin.from("login_otp_challenges").update({attempts:c.attempts+1}).eq("id",c.id);
    return json({ok:false,error:"Code e-mail incorrect."},400);
  }
  const {error:up}=await admin.from("login_otp_challenges").update({verified_at:new Date().toISOString(),consumed_at:new Date().toISOString()}).eq("id",c.id).is("consumed_at",null);
  if(up) throw up;
  return json({ok:true,verified:true});
 }catch(e){console.error(e);return json({ok:false,error:"Impossible de vérifier les codes."},500);}
});