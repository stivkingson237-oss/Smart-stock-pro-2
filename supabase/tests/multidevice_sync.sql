-- Smoke/integration tests for multi-device operational synchronization.
begin;

insert into auth.users(id) values
 ('10000000-0000-0000-0000-000000000001'),
 ('10000000-0000-0000-0000-000000000002'),
 ('10000000-0000-0000-0000-000000000003')
on conflict do nothing;

insert into public.businesses(id,name,owner_id,code,currency)
values ('20000000-0000-0000-0000-000000000001','Test business',
        '10000000-0000-0000-0000-000000000001','TEST-BIZ','XAF')
on conflict do nothing;

insert into public.boutiques(id,business_id,name,code)
values
 ('30000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','Boutique A','TEST-A'),
 ('30000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000001','Boutique B','TEST-B')
on conflict do nothing;

insert into public.memberships(id,business_id,user_id,boutique_id,role,full_name,identification_code)
values
 ('40000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','owner','Owner Test','TEST-OWNER'),
 ('40000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000002','30000000-0000-0000-0000-000000000001','gestionnaire','Manager Test','TEST-MANAGER'),
 ('40000000-0000-0000-0000-000000000003','20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000003','30000000-0000-0000-0000-000000000001','vendeur','Seller Test','TEST-SELLER')
on conflict do nothing;

insert into public.products(id,business_id,boutique_id,name,qty,sale_price)
values
 ('50000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','Product A',2,100),
 ('50000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000002','Product B',5,200)
on conflict do nothing;

set local role authenticated;
set local request.jwt.claim.sub = '10000000-0000-0000-0000-000000000003';

do $$
declare
  result jsonb;
  original_sale uuid;
  qty_now integer;
  visible_other integer;
  cash_count integer;
  realtime_count integer;
begin
  -- Seller can read only the assigned boutique, not Boutique B.
  select count(*) into visible_other from public.products
    where id='50000000-0000-0000-0000-000000000002';
  if visible_other <> 0 then raise exception 'RLS_CROSS_BOUTIQUE_READ_FAILED'; end if;

  -- First sale succeeds; retrying the same event is idempotent.
  result := public.apply_stock_event(
    'sale-event-1','20000000-0000-0000-0000-000000000001',
    '30000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000001',
    'vente',-1,true,1,100,'sale test','Seller Test',null
  );
  if coalesce((result->>'duplicate')::boolean,true) then raise exception 'FIRST_SALE_NOT_CREATED'; end if;

  result := public.apply_stock_event(
    'sale-event-1','20000000-0000-0000-0000-000000000001',
    '30000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000001',
    'vente',-1,true,1,100,'sale test','Seller Test',null
  );
  if not coalesce((result->>'duplicate')::boolean,false) then raise exception 'SALE_RETRY_NOT_IDEMPOTENT'; end if;

  select qty into qty_now from public.products where id='50000000-0000-0000-0000-000000000001';
  if qty_now <> 1 then raise exception 'DUPLICATE_SALE_CHANGED_STOCK_TWICE'; end if;

  -- A second unique sale consumes the last unit. A third sale must fail atomically.
  perform public.apply_stock_event(
    'sale-event-2','20000000-0000-0000-0000-000000000001',
    '30000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000001',
    'vente',-1,true,1,100,'sale test 2','Seller Test',null
  );
  begin
    perform public.apply_stock_event(
      'sale-event-3','20000000-0000-0000-0000-000000000001',
      '30000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000001',
      'vente',-1,true,1,100,'sale test 3','Seller Test',null
    );
    raise exception 'EXPECTED_INSUFFICIENT_STOCK';
  exception when others then
    if sqlerrm not like '%PRODUCT_NOT_FOUND_OR_INSUFFICIENT_STOCK%' then raise; end if;
  end;

  -- A sale can be returned once only, even if a second device sends a new event ID.
  select id into original_sale from public.sales where client_event_id='sale-event-1';
  perform public.apply_stock_event(
    'return-event-1','20000000-0000-0000-0000-000000000001',
    '30000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000001',
    'retour',1,true,-1,-100,'return test','Seller Test',original_sale
  );
  begin
    perform public.apply_stock_event(
      'return-event-2','20000000-0000-0000-0000-000000000001',
      '30000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000001',
      'retour',1,true,-1,-100,'duplicate return test','Seller Test',original_sale
    );
    raise exception 'EXPECTED_SALE_ALREADY_RETURNED';
  exception when others then
    if sqlerrm not like '%SALE_ALREADY_RETURNED%' then raise; end if;
  end;

  -- A seller cannot change stock through an adjustment RPC.
  begin
    perform public.apply_stock_event(
      'seller-adjustment','20000000-0000-0000-0000-000000000001',
      '30000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000001',
      'ajustement',1,true,null,null,'forbidden','Seller Test',null
    );
    raise exception 'EXPECTED_ROLE_CANNOT_MANAGE_STOCK';
  exception when others then
    if sqlerrm not like '%ROLE_CANNOT_MANAGE_STOCK%' then raise; end if;
  end;

  -- Cash movements are also idempotent on retries.
  result := public.record_cash_movement(
    'cash-event-1','20000000-0000-0000-0000-000000000001',
    '30000000-0000-0000-0000-000000000001',50,'cash test','Seller Test'
  );
  result := public.record_cash_movement(
    'cash-event-1','20000000-0000-0000-0000-000000000001',
    '30000000-0000-0000-0000-000000000001',50,'cash test','Seller Test'
  );
  select count(*) into cash_count from public.cash_movements where client_event_id='cash-event-1';
  if cash_count <> 1 then raise exception 'CASH_EVENT_NOT_IDEMPOTENT'; end if;

  select count(*) into realtime_count from pg_publication_tables
    where pubname='supabase_realtime' and schemaname='public'
      and tablename in ('business_snapshots','products','sales','stock_movements','cash_movements');
  if realtime_count <> 5 then raise exception 'REALTIME_PUBLICATION_INCOMPLETE'; end if;
end
$$;

rollback;
