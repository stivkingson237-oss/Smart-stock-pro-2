import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Vary": "Origin",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ ok: false, error: "Méthode non autorisée" }, 405);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const apiKey = Deno.env.get("SASPAY_API_KEY");
    if (!supabaseUrl || !serviceKey || !apiKey) return json({ ok: false, error: "Configuration serveur incomplète" }, 503);

    const authorization = req.headers.get("Authorization") || "";
    const token = authorization.replace(/^Bearer\\s+/i, "");
    if (!token || token === authorization) return json({ ok: false, error: "Connexion requise" }, 401);

    const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: userData, error: authError } = await admin.auth.getUser(token);
    if (authError || !userData.user) return json({ ok: false, error: "Session invalide" }, 401);

    const body = await req.json();
    const localPaymentId = String(body.local_payment_id || "");
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(localPaymentId)) {
      return json({ ok: false, error: "Référence de paiement invalide" }, 400);
    }

    const { data: payment, error: paymentError } = await admin.from("subscription_payments")
      .select("id, business_id, user_id, saspay_payment_id, status")
      .eq("id", localPaymentId).maybeSingle();
    if (paymentError) throw paymentError;
    if (!payment) return json({ ok: false, error: "Paiement introuvable" }, 404);

    const { data: owner, error: ownerError } = await admin.from("memberships")
      .select("id").eq("business_id", payment.business_id)
      .eq("user_id", userData.user.id).eq("role", "owner").maybeSingle();
    if (ownerError) throw ownerError;
    if (!owner) return json({ ok: false, error: "Accès réservé au Patron" }, 403);

    if (payment.status === "PAID" || payment.status === "FAILED") {
      return json({ ok: true, status: payment.status, terminal: true });
    }
    if (!payment.saspay_payment_id) {
      return json({ ok: true, status: "PENDING", terminal: false, message: "Référence fournisseur en cours d'association." });
    }

    const environment = (Deno.env.get("SASPAY_ENV") || "sandbox").toLowerCase();
    const apiBase = environment === "live" ? "https://api.saspay.me" : "https://sandbox-api.saspay.me";
    const verifyResponse = await fetch(
      `${apiBase}/api/v1/payments/${encodeURIComponent(payment.saspay_payment_id)}/verify/`,
      { headers: { Authorization: `Bearer ${apiKey}` }, signal: AbortSignal.timeout(15000) },
    );
    const verifyJson = await verifyResponse.json() as Record<string, unknown>;
    if (!verifyResponse.ok) {
      console.error("SasPay verify refusé:", verifyResponse.status, verifyJson);
      return json({ ok: false, status: "PENDING", error: "Vérification temporairement indisponible." }, 502);
    }
    const data = (verifyJson.data && typeof verifyJson.data === "object" ? verifyJson.data : verifyJson) as Record<string, unknown>;
    const providerStatus = String(data.status || "").toUpperCase();

    if (providerStatus === "SUCCESS") {
      const amount = Number(data.requested_amount ?? data.amount);
      const currency = String(data.currency || "");
      if (!Number.isFinite(amount) || !currency) return json({ ok: false, error: "Montant ou devise absent de la vérification SasPay." }, 502);
      const { data: activation, error: activationError } = await admin.rpc("activate_subscription_from_payment", {
        p_saspay_payment_id: payment.saspay_payment_id,
        p_amount: amount,
        p_currency: currency,
        p_event_payload: verifyJson,
      });
      if (activationError) {
        console.error("Activation après vérification SasPay impossible:", activationError.message);
        return json({ ok: false, error: "Activation impossible pour le moment." }, 500);
      }
      return json({ ok: true, status: activation?.activated ? "PAID" : "PENDING", activation });
    }

    if (["FAILED", "CANCELLED"].includes(providerStatus)) {
      const { error: updateError } = await admin.from("subscription_payments")
        .update({ status: "FAILED", failure_reason: `SasPay verify: ${providerStatus}`, raw_event: verifyJson })
        .eq("id", payment.id).neq("status", "PAID");
      if (updateError) throw updateError;
      return json({ ok: true, status: "FAILED", terminal: true });
    }

    return json({ ok: true, status: "PENDING", terminal: false });
  } catch (error) {
    console.error("Erreur check-subscription-payment:", error);
    return json({ ok: false, error: (error as Error)?.message || "Erreur serveur" }, 500);
  }
});
