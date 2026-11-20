import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Vary": "Origin",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const PLANS: Record<string, { monthly: number; yearly: number }> = {
  PRO: { monthly: 3500, yearly: 35000 },
  BUSINESS: { monthly: 8500, yearly: 85000 },
};

function normalizeCameroonPhone(input: unknown): string | null {
  const digits = String(input ?? "").replace(/[^0-9]/g, "");
  const local = digits.startsWith("237") ? digits.slice(3) : digits;
  if (!/^6[0-9]{8}$/.test(local)) return null;
  return "+237" + local;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ ok: false, error: "Méthode non autorisée" }, 405);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const apiKey = Deno.env.get("SASPAY_API_KEY");
    if (!supabaseUrl || !serviceKey || !apiKey) {
      console.error("Configuration de paiement incomplète : variables serveur manquantes.");
      return json({ ok: false, error: "Le paiement SasPay n'est pas encore configuré sur le serveur." }, 503);
    }

    const authorization = req.headers.get("Authorization") ?? "";
    const token = authorization.replace(/^Bearer\s+/i, "");
    if (!token || token === authorization) return json({ ok: false, error: "Connexion requise." }, 401);

    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: userData, error: userError } = await admin.auth.getUser(token);
    const user = userData?.user;
    if (userError || !user) return json({ ok: false, error: "Session invalide. Reconnectez-vous." }, 401);

    const body = await req.json();
    const businessId = String(body.business_id ?? "");
    const planCode = String(body.plan_code ?? "").toUpperCase();
    const billingCycle = String(body.billing_cycle ?? "");
    const provider = String(body.provider ?? "").toLowerCase();
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(businessId)) {
      return json({ ok: false, error: "Identifiant de boutique invalide." }, 400);
    }
    if (!PLANS[planCode] || !["monthly", "yearly"].includes(billingCycle)) {
      return json({ ok: false, error: "Forfait ou durée invalide." }, 400);
    }
    if (!["mtn", "orange"].includes(provider)) {
      return json({ ok: false, error: "Moyen de paiement non pris en charge." }, 400);
    }
    const phone = normalizeCameroonPhone(body.phone);
    if (!phone) return json({ ok: false, error: "Entrez un numéro MTN ou Orange camerounais valide (6XXXXXXXX)." }, 400);
    if (!user.email) return json({ ok: false, error: "Une adresse e-mail doit être associée à votre compte." }, 400);

    const { data: owner, error: ownerError } = await admin
      .from("memberships")
      .select("id, full_name")
      .eq("business_id", businessId)
      .eq("user_id", user.id)
      .eq("role", "owner")
      .maybeSingle();
    if (ownerError) throw ownerError;
    if (!owner) return json({ ok: false, error: "Seul le Patron de cette boutique peut payer l'abonnement." }, 403);

    const { data: business, error: businessError } = await admin
      .from("businesses")
      .select("name")
      .eq("id", businessId)
      .maybeSingle();
    if (businessError) throw businessError;
    if (!business) return json({ ok: false, error: "Boutique introuvable." }, 404);

    const fullName = String(owner.full_name || user.user_metadata?.full_name || business.name || "Client Smart Stock Pro").trim();
    const nameParts = fullName.split(/\s+/).filter(Boolean);
    const firstName = nameParts.shift() || "Client";
    const lastName = nameParts.join(" ") || firstName;
    const amount = PLANS[planCode][billingCycle === "yearly" ? "yearly" : "monthly"];
    const idempotencyKey = crypto.randomUUID();

    const { data: payment, error: insertError } = await admin
      .from("subscription_payments")
      .insert({
        business_id: businessId,
        user_id: user.id,
        plan_code: planCode,
        billing_cycle: billingCycle,
        amount,
        currency: "XAF",
        provider,
        phone,
        idempotency_key: idempotencyKey,
        status: "PENDING",
      })
      .select("id")
      .single();
    if (insertError || !payment) {
      console.error("Impossible de créer le suivi de paiement:", insertError?.message);
      return json({ ok: false, error: "Impossible de préparer le paiement. Vérifiez que la migration SasPay est appliquée." }, 500);
    }

    const environment = (Deno.env.get("SASPAY_ENV") || "sandbox").toLowerCase();
    const apiBase = environment === "live"
      ? "https://api.saspay.me"
      : "https://sandbox-api.saspay.me";
    const network = provider === "mtn" ? "mtn_cm" : "orange_cm";
    const payload = {
      amount: amount.toFixed(2),
      currency: "XAF",
      country: "CM",
      description: `Abonnement ${planCode} ${billingCycle === "yearly" ? "annuel" : "mensuel"} - Smart Stock Pro 2`,
      customer: { email: user.email, first_name: firstName, last_name: lastName, phone },
      network,
      metadata: {
        subscription_payment_id: payment.id,
        business_id: businessId,
        plan_code: planCode,
        billing_cycle: billingCycle,
      },
    };

    let providerResponse: Response;
    let providerJson: Record<string, unknown>;
    try {
      providerResponse = await fetch(`${apiBase}/api/v1/payments/softpay/`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "Idempotency-Key": idempotencyKey,
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(25000),
      });
      providerJson = await providerResponse.json() as Record<string, unknown>;
    } catch (error) {
      await admin.from("subscription_payments").update({
        status: "FAILED",
        failure_reason: "Erreur réseau lors de la communication avec SasPay.",
      }).eq("id", payment.id);
      console.error("Erreur réseau SasPay:", error);
      return json({ ok: false, error: "SasPay ne répond pas. Vérifiez le statut avant de relancer pour éviter un doublon." }, 502);
    }

    const result = (providerJson.data && typeof providerJson.data === "object"
      ? providerJson.data
      : providerJson) as Record<string, unknown>;
    const paymentId = typeof result.id === "string" ? result.id : "";
    const checkoutUrl = typeof result.checkout_url === "string" ? result.checkout_url : "";
    if (!providerResponse.ok || !paymentId) {
      const message = String(result.message || providerJson.message || "SasPay a refusé la demande.");
      await admin.from("subscription_payments").update({
        status: "FAILED",
        failure_reason: message.slice(0, 500),
        raw_response: providerJson,
      }).eq("id", payment.id);
      console.error("SasPay a refusé l'initiation:", providerResponse.status, message);
      return json({ ok: false, error: message }, 502);
    }

    const { error: updateError } = await admin.from("subscription_payments").update({
      saspay_payment_id: paymentId,
      saspay_reference: typeof result.reference === "string" ? result.reference : null,
      raw_response: providerJson,
    }).eq("id", payment.id);
    if (updateError) {
      console.error("Paiement SasPay créé mais liaison locale impossible:", updateError.message);
      return json({ ok: false, error: "Paiement créé chez SasPay mais liaison locale en attente. Contactez le support avant toute nouvelle tentative." }, 500);
    }

    return json({
      ok: true,
      provider,
      payment_id: paymentId,
      status: String(result.status || "PENDING"),
      checkout_url: checkoutUrl || null,
      instructions: checkoutUrl
        ? "Ouvrez la page SasPay pour terminer le paiement."
        : "Demande envoyée. Validez le paiement sur votre téléphone puis attendez la confirmation.",
    });
  } catch (error) {
    console.error("Erreur initiate-payment:", error);
    return json({ ok: false, error: (error as Error)?.message || "Erreur serveur." }, 500);
  }
});
