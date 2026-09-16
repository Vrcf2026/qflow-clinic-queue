REVOKE EXECUTE ON FUNCTION private.org_now(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION private.ticket_queue_visible(uuid) FROM anon;

REVOKE EXECUTE ON FUNCTION public.my_access() FROM anon;
REVOKE EXECUTE ON FUNCTION public.org_clock() FROM anon;
REVOKE EXECUTE ON FUNCTION public.next_ticket_for_desk(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.skip_ticket(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.recover_ticket(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.org_stats(date,date,uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.platform_stats(date,date) FROM anon;
REVOKE EXECUTE ON FUNCTION public.call_ticket(uuid,uuid,uuid,boolean) FROM anon;
REVOKE EXECUTE ON FUNCTION public.start_service(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.finish_ticket(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.miss_ticket(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.admit_ticket(uuid,text,text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.reset_service_day() FROM anon;