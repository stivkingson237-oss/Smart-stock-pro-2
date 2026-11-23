-- Expose only authenticated RPCs; keep trigger-only functions private.
revoke execute on function public.apply_stock_event(text,uuid,uuid,uuid,text,integer,boolean,integer,numeric,text,text,uuid) from public, anon;
revoke execute on function public.record_cash_movement(text,uuid,uuid,numeric,text,text) from public, anon;
revoke execute on function public.can_access_boutique(uuid,uuid) from public, anon;
revoke execute on function public.can_manage_boutique(uuid,uuid) from public, anon;
revoke execute on function public.get_effective_plan(uuid) from public, anon;
revoke execute on function public.is_member(uuid) from public, anon;
revoke execute on function public.is_owner(uuid) from public, anon;
revoke execute on function public.save_business_snapshot(uuid,jsonb,bigint) from public, anon;
revoke execute on function public.touch_login() from public, anon;
revoke execute on function public.emit_owner_activity_notification() from public, anon, authenticated;

grant execute on function public.apply_stock_event(text,uuid,uuid,uuid,text,integer,boolean,integer,numeric,text,text,uuid) to authenticated;
grant execute on function public.record_cash_movement(text,uuid,uuid,numeric,text,text) to authenticated;
grant execute on function public.can_access_boutique(uuid,uuid) to authenticated;
grant execute on function public.can_manage_boutique(uuid,uuid) to authenticated;
grant execute on function public.get_effective_plan(uuid) to authenticated;
grant execute on function public.is_member(uuid) to authenticated;
grant execute on function public.is_owner(uuid) to authenticated;
grant execute on function public.save_business_snapshot(uuid,jsonb,bigint) to authenticated;
grant execute on function public.touch_login() to authenticated;
