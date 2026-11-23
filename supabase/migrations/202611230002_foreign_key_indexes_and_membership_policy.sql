-- Index foreign-key columns used by joins and cascading operations.
create index if not exists boutiques_business_id_idx on public.boutiques(business_id);
create index if not exists businesses_owner_id_idx on public.businesses(owner_id);
create index if not exists cash_movements_business_id_idx on public.cash_movements(business_id);
create index if not exists cash_movements_boutique_id_idx on public.cash_movements(boutique_id);
create index if not exists cash_movements_employee_membership_id_idx on public.cash_movements(employee_membership_id);
create index if not exists memberships_boutique_id_idx on public.memberships(boutique_id);
create index if not exists memberships_business_id_idx on public.memberships(business_id);
create index if not exists owner_notifications_business_id_idx on public.owner_notifications(business_id);
create index if not exists owner_notifications_boutique_id_idx on public.owner_notifications(boutique_id);
create index if not exists products_boutique_id_idx on public.products(boutique_id);
create index if not exists sales_boutique_id_idx on public.sales(boutique_id);
create index if not exists sales_employee_membership_id_idx on public.sales(employee_membership_id);
create index if not exists sales_product_id_idx on public.sales(product_id);
create index if not exists stock_movements_boutique_id_idx on public.stock_movements(boutique_id);
create index if not exists stock_movements_created_by_membership_id_idx on public.stock_movements(created_by_membership_id);
create index if not exists stock_movements_product_id_idx on public.stock_movements(product_id);
create index if not exists subscription_payments_user_id_idx on public.subscription_payments(user_id);

-- Avoid evaluating auth.uid() once per membership row.
drop policy if exists mb_sel on public.memberships;
create policy mb_sel on public.memberships for select to authenticated
using ((user_id = (select auth.uid())) or is_owner(business_id));
