-- Active les notifications Realtime sur les snapshots de boutique.
-- La politique RLS existante reste réservée au Patron (is_owner) :
-- cette migration n'élargit pas l'accès aux données complètes de l'entreprise.
do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'business_snapshots'
  ) then
    alter publication supabase_realtime add table public.business_snapshots;
  end if;
end
$$;

