// Paiement Orange Money / MTN : à brancher avec vos identifiants marchands.
// Pour l’instant, renvoie un message clair à l’appli.
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
Deno.serve((req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  return new Response(JSON.stringify({ ok: false, error: "Paiement mobile pas encore configuré." }), { headers: { ...cors, "Content-Type": "application/json" } });
});