-- Synchronisation opérationnelle multi-appareils Smart Stock Pro 2.
-- Les snapshots JSON restent réservés au Patron. Les employés travaillent via
-- les tables de leur boutique et des RPC transactionnelles.

-- Identifiants clients stables : une répétition réseau ne crée pas une seconde vente.
alter table public.sales add column if not exists client_event_id text;
alter table public.stock_movements add column if not exists client_event_id text;
create unique index if not exists sales_client_event_id_uidx
  on public.sales(client_event_id) where client_event_id is not null;
create unique index if not exists stock_movements_client_event_id_uidx
  on public.stock_movements(client_event_id) where client_event_id is not null;

-- Sorties de caisse, synchronisées par identifiant d'événement.
create table if not exists public.cash_movements (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  boutique_id uuid not null references public.boutiques(id) on delete cascade,
  amount numeric not null check (amount > 0),
  motif text not null,
  employee_name text,
  client_event_id text,
  created_at timestamptz not null default now()
);
alter table public.cash_movements enable row level security;
create unique index if not exists cash_movements_client_event_id_uidx
  on public.cash_movements(client_event_id) where client_event_id is not null;
drop policy if exists cm_sel on public.cash_movements;
create policy cm_sel on public.cash_movements for select to authenticated
  using (public.can_access_boutique(business_id,boutique_id));

-- Une boutique n'est visible que par son Patron ou ses membres affectés.
drop policy if exists bt_sel on public.boutiques;
create policy bt_sel on public.boutiques for select to authenticated
  using (public.is_owner(business_id) or public.can_access_boutique(business_id,id));

-- Les quantités de stock ne peuvent plus être écrasées par un UPDATE client.
revoke update on public.products from authenticated;
grant update (name,code,category,purchase_price,sale_price,min_stock,supplier)
  on public.products to authenticated;

-- Les ventes et mouvements ne sont insérés que par les fonctions atomiques ci-dessous.
revoke insert on public.sales from authenticated;
revoke insert on public.stock_movements from authenticated;
revoke insert on public.cash_movements from authenticated;

create or replace function public.apply_stock_event(
  p_event_id text,
  p_business_id uuid,
  p_boutique_id uuid,
  p_product_id uuid,
  p_event_type text,
  p_qty_delta integer,
  p_apply_qty boolean default true,
  p_sale_qty integer default null,
  p_sale_total numeric default null,
  p_note text default null,
  p_employee_name text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_role text;
  existing_movement uuid;
  new_movement uuid;
  new_sale uuid;
  resulting_qty integer;
begin
  if auth.uid() is null then raise exception 'NOT_AUTHENTICATED'; end if;
  if p_event_id is null or length(trim(p_event_id)) = 0 then raise exception 'EVENT_ID_REQUIRED'; end if;
  if p_event_type not in ('vente','retour','ajustement','création','entrée','sortie') then
    raise exception 'INVALID_STOCK_EVENT_TYPE';
  end if;

  select m.role into actor_role
  from public.memberships m
  where m.business_id = p_business_id
    and m.user_id = auth.uid()
    and (m.role = 'owner' or m.boutique_id = p_boutique_id)
  order by case when m.role='owner' then 0 else 1 end
  limit 1;

  if actor_role is null then raise exception 'NOT_AUTHORIZED_FOR_BOUTIQUE'; end if;
  if p_event_type in ('ajustement','création','entrée','sortie')
     and actor_role not in ('owner','gestionnaire') then
    raise exception 'ROLE_CANNOT_MANAGE_STOCK';
  end if;
  if p_event_type in ('vente','retour')
     and actor_role not in ('owner','gestionnaire','vendeur','caissier') then
    raise exception 'ROLE_CANNOT_SELL';
  end if;

  if p_sale_qty is not null then
    if p_event_type not in ('vente','retour') then raise exception 'INVALID_SALE_EVENT'; end if;
    if (p_event_type='vente' and (p_sale_qty <= 0 or p_qty_delta <> -p_sale_qty))
       or (p_event_type='retour' and (p_sale_qty >= 0 or p_qty_delta <> -p_sale_qty)) then
      raise exception 'INVALID_SALE_QUANTITY';
    end if;
  end if;

  -- Sérialise les répétitions du même événement, même si deux requêtes arrivent ensemble.
  perform pg_advisory_xact_lock(hashtextextended(p_event_id,0));
  select id into existing_movement
    from public.stock_movements where client_event_id=p_event_id;
  if existing_movement is not null then
    select id into new_sale from public.sales where client_event_id=p_event_id;
    select qty into resulting_qty from public.products where id=p_product_id;
    return jsonb_build_object(
      'duplicate',true,'movement_id',existing_movement,
      'sale_id',new_sale,'product_qty',resulting_qty
    );
  end if;

  if p_product_id is not null then
    if p_apply_qty then
      update public.products
        set qty = qty + coalesce(p_qty_delta,0)
        where id=p_product_id
          and business_id=p_business_id
          and boutique_id=p_boutique_id
          and qty + coalesce(p_qty_delta,0) >= 0
        returning qty into resulting_qty;
      if not found then raise exception 'PRODUCT_NOT_FOUND_OR_INSUFFICIENT_STOCK'; end if;
    else
      select qty into resulting_qty from public.products
        where id=p_product_id and business_id=p_business_id and boutique_id=p_boutique_id;
      if not found then raise exception 'PRODUCT_NOT_FOUND'; end if;
    end if;
  end if;

  insert into public.stock_movements(
    business_id,boutique_id,product_id,type,qty_delta,note,created_by_name,client_event_id
  ) values (
    p_business_id,p_boutique_id,p_product_id,p_event_type,coalesce(p_qty_delta,0),
    p_note,p_employee_name,p_event_id
  ) returning id into new_movement;

  if p_sale_qty is not null then
    insert into public.sales(
      business_id,boutique_id,product_id,employee_name,type,qty,total,note,client_event_id
    ) values (
      p_business_id,p_boutique_id,p_product_id,p_employee_name,p_event_type,
      p_sale_qty,coalesce(p_sale_total,0),p_note,p_event_id
    ) returning id into new_sale;
  end if;

  return jsonb_build_object(
    'duplicate',false,'movement_id',new_movement,'sale_id',new_sale,
    'product_qty',resulting_qty
  );
end;
$$;

create or replace function public.record_cash_movement(
  p_event_id text,
  p_business_id uuid,
  p_boutique_id uuid,
  p_amount numeric,
  p_motif text,
  p_employee_name text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_role text;
  new_id uuid;
begin
  if auth.uid() is null then raise exception 'NOT_AUTHENTICATED'; end if;
  if p_event_id is null or length(trim(p_event_id))=0 then raise exception 'EVENT_ID_REQUIRED'; end if;
  if p_amount is null or p_amount <= 0 or length(trim(coalesce(p_motif,'')))=0 then
    raise exception 'INVALID_CASH_MOVEMENT';
  end if;
  select m.role into actor_role
  from public.memberships m
  where m.business_id=p_business_id and m.user_id=auth.uid()
    and (m.role='owner' or m.boutique_id=p_boutique_id)
  order by case when m.role='owner' then 0 else 1 end
  limit 1;
  if actor_role not in ('owner','gestionnaire','vendeur','caissier') or actor_role is null then
    raise exception 'NOT_AUTHORIZED_FOR_BOUTIQUE';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_event_id,1));
  select id into new_id from public.cash_movements where client_event_id=p_event_id;
  if new_id is not null then return jsonb_build_object('duplicate',true,'id',new_id); end if;
  insert into public.cash_movements(
    business_id,boutique_id,amount,motif,employee_name,client_event_id
  ) values (
    p_business_id,p_boutique_id,p_amount,trim(p_motif),p_employee_name,p_event_id
  ) returning id into new_id;
  return jsonb_build_object('duplicate',false,'id',new_id);
end;
$$;

grant execute on function public.apply_stock_event(text,uuid,uuid,uuid,text,integer,boolean,integer,numeric,text,text) to authenticated;
grant execute on function public.record_cash_movement(text,uuid,uuid,numeric,text,text) to authenticated;
grant select on public.cash_movements to authenticated;

-- Realtime notifie les appareils connectés. RLS filtre les lignes reçues.
do $$
declare t text;
begin
  foreach t in array array['products','sales','stock_movements','cash_movements'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname='supabase_realtime' and schemaname='public' and tablename=t
    ) then
      execute format('alter publication supabase_realtime add table public.%I',t);
    end if;
  end loop;
end
$$;
