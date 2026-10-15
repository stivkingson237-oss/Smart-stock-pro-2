-- SmartStock Pro — base de données. À coller dans Supabase > SQL Editor > Run.
create extension if not exists pgcrypto;

create table if not exists public.businesses (
  id uuid primary key default gen_random_uuid(),
  name text not null, devise text default 'FCFA', pays text,
  owner_id uuid references auth.users(id) on delete set null,
  created_at timestamptz default now());

create table if not exists public.boutiques (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  name text not null, address text, code text, created_at timestamptz default now());

create table if not exists public.memberships (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  boutique_id uuid references public.boutiques(id) on delete set null,
  role text not null check (role in ('owner','gestionnaire','vendeur','caissier')),
  full_name text, identification_code text unique, last_login_at timestamptz,
  created_at timestamptz default now());

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  boutique_id uuid not null references public.boutiques(id) on delete cascade,
  name text not null, code text, category text,
  purchase_price numeric default 0, sale_price numeric default 0,
  qty integer default 0, min_stock integer default 0, supplier text,
  created_at timestamptz default now());

create table if not exists public.sales (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  boutique_id uuid not null references public.boutiques(id) on delete cascade,
  product_id uuid references public.products(id) on delete set null,
  employee_name text, type text default 'vente', qty integer, total numeric, note text,
  created_at timestamptz default now());

create table if not exists public.stock_movements (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  boutique_id uuid not null references public.boutiques(id) on delete cascade,
  product_id uuid references public.products(id) on delete set null,
  type text, qty_delta integer, note text, created_by_name text,
  created_at timestamptz default now());

create table if not exists public.subscriptions (
  business_id uuid primary key references public.businesses(id) on delete cascade,
  plan_code text default 'FREE', status text default 'ACTIVE',
  billing_cycle text, current_period_end timestamptz);

create index if not exists idx_sales_biz_date on public.sales(business_id, created_at desc);
create index if not exists idx_products_biz on public.products(business_id, boutique_id);
create index if not exists idx_mov_biz on public.stock_movements(business_id, created_at desc);
create index if not exists idx_memb_user on public.memberships(user_id);

create or replace function public.is_owner(b uuid) returns boolean
language sql stable security definer set search_path=public as $$
  select exists(select 1 from public.memberships where business_id=b and user_id=auth.uid() and role='owner') $$;
create or replace function public.is_member(b uuid) returns boolean
language sql stable security definer set search_path=public as $$
  select exists(select 1 from public.memberships where business_id=b and user_id=auth.uid()) $$;
create or replace function public.can_access_boutique(b uuid, bt uuid) returns boolean
language sql stable security definer set search_path=public as $$
  select exists(select 1 from public.memberships m where m.business_id=b and m.user_id=auth.uid()
                and (m.role='owner' or m.boutique_id=bt)) $$;
create or replace function public.touch_login() returns void
language sql security definer set search_path=public as $$
  update public.memberships set last_login_at=now() where user_id=auth.uid() $$;
create or replace function public.get_effective_plan(target_business_id uuid)
returns table(plan_code text, sub_status text)
language sql stable security definer set search_path=public as $$
  select case when s.current_period_end is not null and s.current_period_end < now() then 'FREE' else coalesce(s.plan_code,'FREE') end,
         case when s.current_period_end is not null and s.current_period_end < now() then 'EXPIRED' else coalesce(s.status,'ACTIVE') end
  from (select 1) x left join public.subscriptions s on s.business_id=target_business_id
  where public.is_member(target_business_id) $$;

alter table public.businesses enable row level security;
alter table public.boutiques enable row level security;
alter table public.memberships enable row level security;
alter table public.products enable row level security;
alter table public.sales enable row level security;
alter table public.stock_movements enable row level security;
alter table public.subscriptions enable row level security;

drop policy if exists biz_sel on public.businesses; create policy biz_sel on public.businesses for select to authenticated using (public.is_member(id));
drop policy if exists biz_upd on public.businesses; create policy biz_upd on public.businesses for update to authenticated using (public.is_owner(id));
drop policy if exists bt_sel on public.boutiques; create policy bt_sel on public.boutiques for select to authenticated using (public.is_member(business_id));
drop policy if exists bt_ins on public.boutiques; create policy bt_ins on public.boutiques for insert to authenticated with check (public.is_owner(business_id));
drop policy if exists bt_upd on public.boutiques; create policy bt_upd on public.boutiques for update to authenticated using (public.is_owner(business_id));
drop policy if exists bt_del on public.boutiques; create policy bt_del on public.boutiques for delete to authenticated using (public.is_owner(business_id));
drop policy if exists mb_sel on public.memberships; create policy mb_sel on public.memberships for select to authenticated using (user_id=auth.uid() or public.is_owner(business_id));
drop policy if exists pr_sel on public.products; create policy pr_sel on public.products for select to authenticated using (public.can_access_boutique(business_id,boutique_id));
drop policy if exists pr_ins on public.products; create policy pr_ins on public.products for insert to authenticated with check (public.can_access_boutique(business_id,boutique_id));
drop policy if exists pr_upd on public.products; create policy pr_upd on public.products for update to authenticated using (public.can_access_boutique(business_id,boutique_id)) with check (public.can_access_boutique(business_id,boutique_id));
drop policy if exists pr_del on public.products; create policy pr_del on public.products for delete to authenticated using (public.can_access_boutique(business_id,boutique_id));
drop policy if exists sa_sel on public.sales; create policy sa_sel on public.sales for select to authenticated using (public.can_access_boutique(business_id,boutique_id));
drop policy if exists sa_ins on public.sales; create policy sa_ins on public.sales for insert to authenticated with check (public.can_access_boutique(business_id,boutique_id));
drop policy if exists sm_sel on public.stock_movements; create policy sm_sel on public.stock_movements for select to authenticated using (public.can_access_boutique(business_id,boutique_id));
drop policy if exists sm_ins on public.stock_movements; create policy sm_ins on public.stock_movements for insert to authenticated with check (public.can_access_boutique(business_id,boutique_id));
drop policy if exists su_sel on public.subscriptions; create policy su_sel on public.subscriptions for select to authenticated using (public.is_owner(business_id));
grant usage on schema public to anon, authenticated;
grant select,insert,update,delete on all tables in schema public to authenticated;
grant execute on all functions in schema public to authenticated;
