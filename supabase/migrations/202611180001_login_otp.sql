-- Smart Stock Pro 2: défis OTP double canal (e-mail + SMS).
alter table public.businesses add column if not exists email text;
alter table public.businesses add column if not exists phone text;
create table if not exists public.login_otp_challenges (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  email_code_hash text not null,
  sms_code_hash text not null,
  expires_at timestamptz not null,
  attempts integer not null default 0,
  verified_at timestamptz,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists login_otp_user_created_idx
  on public.login_otp_challenges(user_id, created_at desc);
alter table public.login_otp_challenges enable row level security;
revoke all on public.login_otp_challenges from anon, authenticated;
grant all on public.login_otp_challenges to service_role;

-- Bind the successful OTP challenge to the exact Supabase Auth session.
alter table public.login_otp_challenges add column if not exists bound_session_id uuid;

create or replace function public.has_verified_login_session()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.uid() is not null and exists (
    select 1
    from public.login_otp_challenges c
    where c.user_id = auth.uid()
      and c.bound_session_id::text = (auth.jwt() ->> 'session_id')
      and c.verified_at is not null
  );
$$;
grant execute on function public.has_verified_login_session() to authenticated;

create or replace function public.is_owner(b uuid) returns boolean
language sql stable security definer set search_path=public as $$
  select public.has_verified_login_session() and exists(
    select 1 from public.memberships
    where business_id=b and user_id=auth.uid() and role='owner'
  );
$$;

create or replace function public.is_member(b uuid) returns boolean
language sql stable security definer set search_path=public as $$
  select public.has_verified_login_session() and exists(
    select 1 from public.memberships
    where business_id=b and user_id=auth.uid()
  );
$$;

create or replace function public.can_access_boutique(b uuid, bt uuid) returns boolean
language sql stable security definer set search_path=public as $$
  select public.has_verified_login_session() and exists(
    select 1 from public.memberships m
    where m.business_id=b and m.user_id=auth.uid()
      and (m.role='owner' or m.boutique_id=bt)
  );
$$;
