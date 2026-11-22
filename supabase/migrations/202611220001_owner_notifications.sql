-- Notifications d'activité temps réel destinées au Patron de l'entreprise.
create table if not exists public.owner_notifications (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  boutique_id uuid references public.boutiques(id) on delete set null,
  event_type text not null,
  title text not null,
  message text not null,
  actor_name text,
  created_at timestamptz not null default now(),
  read_at timestamptz
);
alter table public.owner_notifications enable row level security;
revoke all on public.owner_notifications from anon, authenticated;
grant select on public.owner_notifications to authenticated;
drop policy if exists owner_notifications_owner_read on public.owner_notifications;
create policy owner_notifications_owner_read on public.owner_notifications
 for select to authenticated using (public.is_owner(business_id));

create or replace function public.emit_owner_activity_notification()
returns trigger language plpgsql security definer
set search_path=public,pg_catalog
as $$
declare
  v_type text;
  v_title text;
  v_message text;
  v_actor text;
begin
  if tg_table_name='sales' then
    if coalesce(to_jsonb(new)->>'type','vente')='retour' then
      v_type:='return'; v_title:='Retour de vente enregistré';
      v_message:='Un retour de vente vient d’être enregistré.';
    else
      v_type:='sale'; v_title:='Nouvelle vente';
      v_message:='Une vente vient d’être enregistrée.';
    end if;
    v_actor:=nullif(to_jsonb(new)->>'employee_name','');
  elsif tg_table_name='cash_movements' then
    v_type:='cash'; v_title:='Mouvement de caisse';
    v_message:='Un mouvement de caisse de '||coalesce(to_jsonb(new)->>'amount','')||' a été enregistré : '||coalesce(to_jsonb(new)->>'motif','');
    v_actor:=nullif(to_jsonb(new)->>'employee_name','');
  else
    if coalesce(to_jsonb(new)->>'type','') in ('vente','retour') then return new; end if;
    v_type:='stock'; v_title:='Mouvement de stock';
    v_message:='Une opération de stock ('||coalesce(to_jsonb(new)->>'event_type','stock')||') a été enregistrée.';
    v_actor:=nullif(to_jsonb(new)->>'created_by_name','');
  end if;
  insert into public.owner_notifications(business_id,boutique_id,event_type,title,message,actor_name)
  values(new.business_id,new.boutique_id,v_type,v_title,v_message,v_actor);
  return new;
end;
$$;

drop trigger if exists notify_owner_after_sale on public.sales;
create trigger notify_owner_after_sale after insert on public.sales
 for each row execute function public.emit_owner_activity_notification();
drop trigger if exists notify_owner_after_cash_movement on public.cash_movements;
create trigger notify_owner_after_cash_movement after insert on public.cash_movements
 for each row execute function public.emit_owner_activity_notification();
drop trigger if exists notify_owner_after_stock_movement on public.stock_movements;
create trigger notify_owner_after_stock_movement after insert on public.stock_movements
 for each row execute function public.emit_owner_activity_notification();

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname='supabase_realtime' and schemaname='public' and tablename='owner_notifications'
  ) then
    alter publication supabase_realtime add table public.owner_notifications;
  end if;
end $$;
