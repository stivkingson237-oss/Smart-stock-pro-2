import { createClient } from "npm:@supabase/supabase-js@2";
const cors={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type","Access-Control-Allow-Methods":"POST, OPTIONS"};
const json=(b:unknown,s=200)=>new Response(JSON.stringify(b),{status:s,headers:{...cors,"Content-Type":"application/json"}});
const admin=createClient(Deno.env.get("SUPABASE_URL")!,Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,{auth:{persistSession:false}});
Deno.serve(async(req)=>{
 if(req.method==="OPTIONS") return new Response("ok",{headers:cors});
 if(req.method!=="POST") return json({ok:false,error:"Méthode non autorisée"},405);
 try{
  const token=(req.headers.get("Authorization")||"").replace(/^Bearer\s+/i,"");
  if(!token) return json({ok:false,error:"Session absente."},401);
  const {data,error}=await admin.auth.getUser(token);
  if(error||!data.user) return json({ok:false,error:"Session invalide."},401);
  const parts=token.split(".");
  if(parts.length!==3) return json({ok:false,error:"Jeton invalide."},401);
  const payload=JSON.parse(atob(parts[1].replace(/-/g,"+").replace(/_/g,"/")));
  const sessionId=String(payload.session_id||"");
  if(!/^[0-9a-f-]{36}$/i.test(sessionId)) return json({ok:false,error:"Identifiant de session absent."},401);
  const since=new Date(Date.now()-2*60*1000).toISOString();
  const {data:challenge,error:findError}=await admin.from("login_otp_challenges").select("id").eq("user_id",data.user.id).not("verified_at","is",null).is("bound_session_id",null).gte("verified_at",since).order("verified_at",{ascending:false}).limit(1).maybeSingle();
  if(findError) throw findError;
  if(!challenge) return json({ok:false,error:"Validation par e-mail requise avant la connexion."},403);
  const {data:updated,error:updateError}=await admin.from("login_otp_challenges").update({bound_session_id:sessionId}).eq("id",challenge.id).is("bound_session_id",null).select("id").maybeSingle();
  if(updateError) throw updateError;
  if(!updated) return json({ok:false,error:"Ce code a déjà été associé à une autre session. Recommencez la vérification."},409);
  return json({ok:true,bound:true});
 }catch(e){console.error(e);return json({ok:false,error:"Impossible de sécuriser cette session."},500);}
});