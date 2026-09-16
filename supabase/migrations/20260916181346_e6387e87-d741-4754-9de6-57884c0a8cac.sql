REVOKE EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) FROM anon;
REVOKE EXECUTE ON FUNCTION public.is_super_admin() FROM anon;
REVOKE EXECUTE ON FUNCTION public.current_org_id() FROM anon;
REVOKE EXECUTE ON FUNCTION public.can_manage_org_config() FROM anon;
REVOKE EXECUTE ON FUNCTION public.org_day_start(uuid) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM anon, authenticated;
