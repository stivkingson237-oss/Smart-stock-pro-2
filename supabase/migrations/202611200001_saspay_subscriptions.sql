-- SasPay Cameroon: suivi des paiements d'abonnement et activation serveur uniquement.
create table if not exists public.subscription_payments (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  plan_code text not null check (plan_code in ('PRO','BUSINESS')),
  billing_cycle text not null check (billing_cycle in ('monthly','yearly')),
  amount numeric(12,2) not null check (amount > 0),
  currency text not null default 'XAF' check (currency = 'XAF'),
  provider text not null check (provider in ('mtn','orange')),
  phone text not null,
  idempotency_key uuid not null unique,
  saspay_payment_id text unique,
  saspay_reference text,
  status text not null default 'PENDING' check (status in ('PENDING','PAID','FAILED')),
  failure_reason text,
  raw_response jsonb,
  raw_event jsonb,
  created_at timestamptz not null default now(),
  paid_at timestamptz
);

create index if not exists subscription_payments_business_created_idx
  on public.subscription_payments(business_id, created_at desc);
create index if not exists subscription_payments_status_created_idx
  on public.subscription_payments(status, created_at desc);

alter table public.subscription_payments enable row level security;
revoke all on public.subscription_payments from anon, authenticated;
grant all on public.subscription_payments to service_role;

create table if not exists public.saspay_webhook_events (
  event_id text primary key,
  event_type text not null,
  payload jsonb not null,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  processing_error text
);
alter table public.saspay_webhook_events enable row level security;
revoke all on public.saspay_webhook_events from anon, authenticated;
grant all on public.saspay_webhook_events to service_role;

-- Une seule opération atomique : paiement vérifié, abonnement prolongé, paiement marqué PAID.
create or replace function public.activate_subscription_from_payment(
  p_saspay_payment_id text,
  p_amount numeric,
  p_currency text,
  p_event_payload jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  payment_row public.subscription_payments%rowtype;
  current_end timestamptz;
  period_start timestamptz;
  period_end timestamptz;
begin
  select * into payment_row
    from public.subscription_payments
    where saspay_payment_id = p_saspay_payment_id
    for update;

  if not found then
    return jsonb_build_object('activated', false, 'reason', 'PAYMENT_NOT_FOUND');
  end if;

  if payment_row.status = 'PAID' then
    return jsonb_build_object('activated', true, 'duplicate', true);
  end if;

  if payment_row.status <> 'PENDING' then
    return jsonb_build_object('activated', false, 'reason', 'PAYMENT_NOT_PENDING');
  end if;

  if round(payment_row.amount, 2) <> round(coalesce(p_amount, 0), 2)
     or payment_row.currency <> p_currency then
    raise exception 'SASPAY_AMOUNT_OR_CURRENCY_MISMATCH';
  end if;

  select current_period_end into current_end
    from public.subscriptions
    where business_id = payment_row.business_id
    for update;

  period_start := case
    when current_end is not null and current_end > now() then current_end
    else now()
  end;
  period_end := case
    when payment_row.billing_cycle = 'yearly' then period_start + interval '1 year'
    else period_start + interval '1 month'
  end;

  insert into public.subscriptions(business_id, plan_code, status, billing_cycle, current_period_end)
  values (payment_row.business_id, payment_row.plan_code, 'ACTIVE', payment_row.billing_cycle, period_end)
  on conflict (business_id) do update
    set plan_code = excluded.plan_code,
        status = 'ACTIVE',
        billing_cycle = excluded.billing_cycle,
        current_period_end = excluded.current_period_end;

  update public.subscription_payments
    set status = 'PAID',
        paid_at = now(),
        raw_event = p_event_payload,
        saspay_reference = coalesce(p_event_payload #>> '{data,reference}', saspay_reference),
        failure_reason = null
    where id = payment_row.id;

  return jsonb_build_object('activated', true, 'duplicate', false, 'period_end', period_end);
end;
$$;

revoke all on function public.activate_subscription_from_payment(text, numeric, text, jsonb) from public, anon, authenticated;
grant execute on function public.activate_subscription_from_payment(text, numeric, text, jsonb) to service_role;
