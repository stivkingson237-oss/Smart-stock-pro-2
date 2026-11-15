import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, x-webhook-signature, x-webhook-timestamp, x-webhook-event",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function hexToBytes(hex: string): Uint8Array | null {
  if (!/^[0-9a-f]{64}$/i.test(hex)) return null;
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

async function sign(secret: string, message: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message)));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  if (req.method !== "POST") return json({ ok: false, error: "Méthode non autorisée" }, 405);

  const secret = Deno.env.get("SASPAY_WEBHOOK_SECRET");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!secret || !supabaseUrl || !serviceRoleKey) {
    console.error("Configuration webhook incomplète");
    return json({ ok: false, error: "Configuration serveur incomplète" }, 500);
  }

  const signature = req.headers.get("x-webhook-signature") ?? "";
  const timestamp = req.headers.get("x-webhook-timestamp") ?? "";
  const headerEvent = req.headers.get("x-webhook-event");
  if (!/^\d{10,}$/.test(timestamp)) return json({ ok: false, error: "Horodatage invalide" }, 401);
  const age = Math.abs(Math.floor(Date.now() / 1000) - Number(timestamp));
  if (!Number.isFinite(age) || age > 300) return json({ ok: false, error: "Webhook expiré" }, 401);

  // La signature doit être calculée sur le corps brut, avant tout parsing JSON.
  const rawBody = await req.text();
  const supplied = hexToBytes(signature);
  if (!supplied) return json({ ok: false, error: "Signature invalide" }, 401);
  const expected = await sign(secret, `${timestamp}.${rawBody}`);
  if (!constantTimeEqual(supplied, expected)) return json({ ok: false, error: "Signature invalide" }, 401);

  let payload: { event?: unknown; data?: { id?: unknown; status?: unknown } };
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return json({ ok: false, error: "JSON invalide" }, 400);
  }

  const eventType = typeof payload.event === "string" ? payload.event : headerEvent;
  const eventId = payload.data && typeof payload.data.id === "string" ? payload.data.id : "";
  if (!eventType || !eventId) return json({ ok: false, error: "Événement ou identifiant manquant" }, 400);
  if (headerEvent && headerEvent !== eventType) return json({ ok: false, error: "Type d'événement incohérent" }, 400);

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const idempotencyKey = `${eventType}:${eventId}`;
  const { error } = await supabase.from("saspay_webhook_events").upsert(
    { event_id: idempotencyKey, event_type: eventType, payload },
    { onConflict: "event_id", ignoreDuplicates: true },
  );
  if (error) {
    console.error("Échec enregistrement événement SasPay:", error.message);
    return json({ ok: false, error: "Impossible d'enregistrer l'événement" }, 500);
  }

  // Important : l'enregistrement est idempotent. L'activation d'un abonnement
  // sera faite après association de la transaction à une commande Smart Stock Pro.
  return json({ ok: true, received: true });
});
