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
