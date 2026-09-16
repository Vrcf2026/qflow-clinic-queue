-- Server-side ticket actions (authoritative clock + audit trail)

CREATE OR REPLACE FUNCTION public.call_ticket(
  p_ticket_id uuid,
  p_desk_id uuid DEFAULT NULL,
  p_cabinet_id uuid DEFAULT NULL,
  p_recall boolean DEFAULT false
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE o uuid := private.current_org_id(); t public.tickets; dname text; cname text;
BEGIN
  IF o IS NULL THEN RETURN jsonb_build_object('error','no_access'); END IF;
  SELECT * INTO t FROM public.tickets WHERE id = p_ticket_id AND org_id = o;
  IF t.id IS NULL THEN RETURN jsonb_build_object('error','not_found'); END IF;
  IF NOT private.ticket_queue_visible(t.queue_id) THEN RETURN jsonb_build_object('error','forbidden'); END IF;

  SELECT name INTO dname FROM public.desks WHERE id = p_desk_id AND org_id = o;
  SELECT name INTO cname FROM public.cabinets WHERE id = p_cabinet_id AND org_id = o;

  UPDATE public.tickets SET
    status = 'chamado',
    called_at = now(),
    desk_id = COALESCE(p_desk_id, desk_id),
    cabinet_id = COALESCE(p_cabinet_id, cabinet_id),
    recall_count = recall_count + CASE WHEN p_recall THEN 1 ELSE 0 END
  WHERE id = t.id;

  INSERT INTO public.call_log (org_id, ticket_id, full_ticket, called_by_user_id, desk_name, cabinet_name, called_at)
  VALUES (o, t.id, t.full_ticket, auth.uid(), dname, cname, now());

  INSERT INTO public.ticket_events (org_id, ticket_id, full_ticket, event, actor_user_id, detail)
  VALUES (o, t.id, t.full_ticket, CASE WHEN p_recall THEN 'rechamada' ELSE 'chamada' END, auth.uid(),
          jsonb_build_object('destination', COALESCE(dname, cname)));

  RETURN jsonb_build_object('status','chamado','destination',COALESCE(dname,cname),'server_now',now());
END; $$;
COMMENT ON FUNCTION public.call_ticket(uuid,uuid,uuid,boolean) IS 'Call or re-call a ticket from a desk or cabinet. Sets called_at from the server clock, writes call_log and a ticket event. Doctors limited to their cabinet queues.';
REVOKE ALL ON FUNCTION public.call_ticket(uuid,uuid,uuid,boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.call_ticket(uuid,uuid,uuid,boolean) TO authenticated;

CREATE OR REPLACE FUNCTION public.start_service(p_ticket_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE o uuid := private.current_org_id(); t public.tickets;
BEGIN
  IF o IS NULL THEN RETURN jsonb_build_object('error','no_access'); END IF;
  SELECT * INTO t FROM public.tickets WHERE id = p_ticket_id AND org_id = o;
  IF t.id IS NULL THEN RETURN jsonb_build_object('error','not_found'); END IF;
  IF NOT private.ticket_queue_visible(t.queue_id) THEN RETURN jsonb_build_object('error','forbidden'); END IF;
  UPDATE public.tickets SET status = 'em_atendimento' WHERE id = t.id;
  INSERT INTO public.ticket_events (org_id, ticket_id, full_ticket, event, actor_user_id)
  VALUES (o, t.id, t.full_ticket, 'em_atendimento', auth.uid());
  RETURN jsonb_build_object('status','em_atendimento','server_now',now());
END; $$;
COMMENT ON FUNCTION public.start_service(uuid) IS 'Mark a called ticket as being served.';
REVOKE ALL ON FUNCTION public.start_service(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.start_service(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.finish_ticket(p_ticket_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE o uuid := private.current_org_id(); t public.tickets; mins int; cur int;
BEGIN
  IF o IS NULL THEN RETURN jsonb_build_object('error','no_access'); END IF;
  SELECT * INTO t FROM public.tickets WHERE id = p_ticket_id AND org_id = o;
  IF t.id IS NULL THEN RETURN jsonb_build_object('error','not_found'); END IF;
  IF NOT private.ticket_queue_visible(t.queue_id) THEN RETURN jsonb_build_object('error','forbidden'); END IF;

  UPDATE public.tickets SET status = 'concluido', done_at = now() WHERE id = t.id;
  INSERT INTO public.ticket_events (org_id, ticket_id, full_ticket, event, actor_user_id)
  VALUES (o, t.id, t.full_ticket, 'concluida', auth.uid());

  IF t.called_at IS NOT NULL THEN
    mins := GREATEST(1, round(EXTRACT(EPOCH FROM (now() - t.called_at))/60)::int);
    SELECT avg_duration_minutes INTO cur FROM public.queues WHERE id = t.queue_id;
    IF cur IS NOT NULL THEN
      UPDATE public.queues SET avg_duration_minutes = GREATEST(1, round(cur*0.8 + mins*0.2)::int)
      WHERE id = t.queue_id;
    END IF;
  END IF;
  RETURN jsonb_build_object('status','concluido','server_now',now());
END; $$;
COMMENT ON FUNCTION public.finish_ticket(uuid) IS 'Finish a ticket with the server clock and blend the real duration into the queue average (80/20).';
REVOKE ALL ON FUNCTION public.finish_ticket(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.finish_ticket(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.miss_ticket(p_ticket_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE o uuid := private.current_org_id(); t public.tickets;
BEGIN
  IF o IS NULL THEN RETURN jsonb_build_object('error','no_access'); END IF;
  SELECT * INTO t FROM public.tickets WHERE id = p_ticket_id AND org_id = o;
  IF t.id IS NULL THEN RETURN jsonb_build_object('error','not_found'); END IF;
  IF NOT private.ticket_queue_visible(t.queue_id) THEN RETURN jsonb_build_object('error','forbidden'); END IF;
  UPDATE public.tickets SET status = 'faltou', done_at = now() WHERE id = t.id;
  INSERT INTO public.ticket_events (org_id, ticket_id, full_ticket, event, actor_user_id, detail)
  VALUES (o, t.id, t.full_ticket, 'faltou', auth.uid(), jsonb_build_object('reason','manual'));
  RETURN jsonb_build_object('status','faltou','server_now',now());
END; $$;
COMMENT ON FUNCTION public.miss_ticket(uuid) IS 'Mark a ticket as faltou; recoverable within organizations.missed_recovery_minutes.';
REVOKE ALL ON FUNCTION public.miss_ticket(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.miss_ticket(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.admit_ticket(p_ticket_id uuid, p_name text, p_utente text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE o uuid := private.current_org_id(); t public.tickets;
BEGIN
  IF o IS NULL THEN RETURN jsonb_build_object('error','no_access'); END IF;
  SELECT * INTO t FROM public.tickets WHERE id = p_ticket_id AND org_id = o;
  IF t.id IS NULL THEN RETURN jsonb_build_object('error','not_found'); END IF;
  IF NOT private.ticket_queue_visible(t.queue_id) THEN RETURN jsonb_build_object('error','forbidden'); END IF;
  IF COALESCE(btrim(p_name),'') = '' THEN RETURN jsonb_build_object('error','name_required'); END IF;
  UPDATE public.tickets SET patient_name = btrim(p_name),
    patient_utente = NULLIF(btrim(COALESCE(p_utente,'')),'')
  WHERE id = t.id;
  INSERT INTO public.ticket_events (org_id, ticket_id, full_ticket, event, actor_user_id)
  VALUES (o, t.id, t.full_ticket, 'admitida', auth.uid());
  RETURN jsonb_build_object('status','ok','server_now',now());
END; $$;
COMMENT ON FUNCTION public.admit_ticket(uuid,text,text) IS 'Attach patient name and optional health number to a ticket (reception admission).';
REVOKE ALL ON FUNCTION public.admit_ticket(uuid,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admit_ticket(uuid,text,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.reset_service_day()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE o uuid := private.current_org_id(); n int;
BEGIN
  IF o IS NULL THEN RETURN jsonb_build_object('error','no_access'); END IF;
  IF NOT private.can_manage_org_config() THEN RETURN jsonb_build_object('error','forbidden'); END IF;
  WITH upd AS (
    UPDATE public.tickets SET status = 'concluido', done_at = now()
    WHERE org_id = o AND created_at >= private.org_day_start(o)
      AND status IN ('em_espera','chamado','em_atendimento')
    RETURNING id, full_ticket
  ), ev AS (
    INSERT INTO public.ticket_events (org_id, ticket_id, full_ticket, event, actor_user_id, detail)
    SELECT o, id, full_ticket, 'concluida', auth.uid(), jsonb_build_object('reason','reset_dia') FROM upd
    RETURNING 1
  )
  SELECT count(*) INTO n FROM ev;
  RETURN jsonb_build_object('closed', n, 'server_now', now());
END; $$;
COMMENT ON FUNCTION public.reset_service_day() IS 'Shift lead / admin action: closes every open ticket of the current service day and logs the reason.';
REVOKE ALL ON FUNCTION public.reset_service_day() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reset_service_day() TO authenticated;