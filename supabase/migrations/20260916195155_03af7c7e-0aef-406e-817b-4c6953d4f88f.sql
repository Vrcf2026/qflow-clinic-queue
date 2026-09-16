-- ============================================================
-- QFlow: server clock, skip tracking, closed access, stats
-- ============================================================

-- ---------- org settings ----------
ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS skip_reinsert_after integer NOT NULL DEFAULT 3,
  ADD COLUMN IF NOT EXISTS max_skips integer NOT NULL DEFAULT 3,
  ADD COLUMN IF NOT EXISTS missed_recovery_minutes integer NOT NULL DEFAULT 60;

-- ---------- ticket tracking ----------
ALTER TABLE public.tickets
  ADD COLUMN IF NOT EXISTS skip_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS recall_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_skipped_at timestamptz,
  ADD COLUMN IF NOT EXISTS sort_at timestamptz;

UPDATE public.tickets SET sort_at = created_at WHERE sort_at IS NULL;
ALTER TABLE public.tickets ALTER COLUMN sort_at SET DEFAULT now();
ALTER TABLE public.tickets ALTER COLUMN sort_at SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_tickets_sort ON public.tickets (queue_id, status, priority DESC, sort_at);

-- ---------- audit trail ----------
CREATE TABLE IF NOT EXISTS public.ticket_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  ticket_id uuid REFERENCES public.tickets(id) ON DELETE SET NULL,
  full_ticket text NOT NULL,
  event text NOT NULL,
  actor_user_id uuid,
  device_id uuid,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.ticket_events IS 'Audit trail for every ticket transition: emitida, chamada, rechamada, saltada, faltou, recuperada, admitida, concluida.';

GRANT SELECT, INSERT ON public.ticket_events TO authenticated;
GRANT ALL ON public.ticket_events TO service_role;
ALTER TABLE public.ticket_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS te_select ON public.ticket_events;
CREATE POLICY te_select ON public.ticket_events FOR SELECT TO authenticated
  USING ((org_id = private.current_org_id()) OR private.is_super_admin());
DROP POLICY IF EXISTS te_insert ON public.ticket_events;
CREATE POLICY te_insert ON public.ticket_events FOR INSERT TO authenticated
  WITH CHECK ((org_id = private.current_org_id()) OR private.is_super_admin());

CREATE INDEX IF NOT EXISTS idx_ticket_events_org ON public.ticket_events (org_id, created_at DESC);

-- ---------- helpers: active profile + org clock ----------
CREATE OR REPLACE FUNCTION private.current_org_id()
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT org_id FROM public.profiles WHERE id = auth.uid() AND active = true
$$;
COMMENT ON FUNCTION private.current_org_id() IS 'Org of the signed-in user; NULL when the profile is inactive (blocks all org data).';

CREATE OR REPLACE FUNCTION private.org_now(p_org uuid)
RETURNS timestamptz LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT now()
$$;
COMMENT ON FUNCTION private.org_now(uuid) IS 'Authoritative server instant (clients must never use their own clock).';

CREATE OR REPLACE FUNCTION private.org_day_start(_org_id uuid)
RETURNS timestamptz LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE tz text; rt text; local_now timestamp; d date; start_local timestamp;
BEGIN
  SELECT COALESCE(timezone,'Europe/Lisbon'), COALESCE(reset_time,'08:00')
    INTO tz, rt FROM public.organizations WHERE id = _org_id;
  IF tz IS NULL THEN tz := 'Europe/Lisbon'; rt := '08:00'; END IF;
  local_now := now() AT TIME ZONE tz;
  d := local_now::date;
  start_local := d::timestamp + rt::time;
  IF local_now < start_local THEN
    start_local := start_local - interval '1 day';
  END IF;
  RETURN start_local AT TIME ZONE tz;
END; $$;
COMMENT ON FUNCTION private.org_day_start(uuid) IS 'Start of the current service day, computed from the org timezone and reset_time on the server.';

-- ---------- doctor scoping ----------
CREATE OR REPLACE FUNCTION private.ticket_queue_visible(p_queue uuid)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := auth.uid(); cab uuid; only_medico boolean;
BEGIN
  IF uid IS NULL THEN RETURN false; END IF;
  SELECT NOT EXISTS (
    SELECT 1 FROM public.user_roles r
    WHERE r.user_id = uid AND r.role <> 'medico'
  ) AND EXISTS (
    SELECT 1 FROM public.user_roles r WHERE r.user_id = uid AND r.role = 'medico'
  ) INTO only_medico;

  IF NOT only_medico THEN RETURN true; END IF;

  SELECT cabinet_id INTO cab FROM public.profiles WHERE id = uid;
  IF cab IS NULL THEN RETURN false; END IF;
  RETURN EXISTS (
    SELECT 1 FROM public.cabinets c
    WHERE c.id = cab AND (c.queue_ids ? p_queue::text)
  );
END; $$;
COMMENT ON FUNCTION private.ticket_queue_visible(uuid) IS 'True unless the caller is only a doctor: doctors see only queues assigned to their cabinet.';

DROP POLICY IF EXISTS t_select ON public.tickets;
CREATE POLICY t_select ON public.tickets FOR SELECT TO authenticated
  USING (
    private.is_super_admin()
    OR (org_id = private.current_org_id() AND private.ticket_queue_visible(queue_id))
  );

-- ---------- close public (anon) read access ----------
DROP POLICY IF EXISTS t_public ON public.tickets;
DROP POLICY IF EXISTS q_public ON public.queues;
DROP POLICY IF EXISTS d_public ON public.desks;
DROP POLICY IF EXISTS c_public ON public.cabinets;
DROP POLICY IF EXISTS cl_public ON public.call_log;
DROP POLICY IF EXISTS org_public_select ON public.organizations;

REVOKE ALL ON public.tickets FROM anon;
REVOKE ALL ON public.queues FROM anon;
REVOKE ALL ON public.desks FROM anon;
REVOKE ALL ON public.cabinets FROM anon;
REVOKE ALL ON public.call_log FROM anon;
REVOKE ALL ON public.organizations FROM anon;

-- ---------- session bootstrap (replaces bootstrap_access) ----------
DROP FUNCTION IF EXISTS public.bootstrap_access();

CREATE OR REPLACE FUNCTION public.my_access()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := auth.uid(); p public.profiles; org public.organizations; roles text[];
BEGIN
  IF uid IS NULL THEN RETURN jsonb_build_object('error','not_authenticated'); END IF;
  SELECT * INTO p FROM public.profiles WHERE id = uid;
  IF p.id IS NULL OR p.active = false THEN
    RETURN jsonb_build_object('error','no_access','server_now', now());
  END IF;
  SELECT array_agg(role::text) INTO roles FROM public.user_roles WHERE user_id = uid;
  IF p.org_id IS NOT NULL THEN
    SELECT * INTO org FROM public.organizations WHERE id = p.org_id;
  END IF;
  RETURN jsonb_build_object(
    'profile', to_jsonb(p),
    'org', to_jsonb(org),
    'roles', COALESCE(to_jsonb(roles), '[]'::jsonb),
    'server_now', now(),
    'day_start', CASE WHEN p.org_id IS NOT NULL THEN private.org_day_start(p.org_id) END
  );
END; $$;
COMMENT ON FUNCTION public.my_access() IS 'Session bootstrap: profile, org, roles, authoritative server time and current service-day start. Callable by authenticated users only.';
REVOKE ALL ON FUNCTION public.my_access() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.my_access() TO authenticated;

-- ---------- server clock for signed-in screens ----------
CREATE OR REPLACE FUNCTION public.org_clock()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE o uuid := private.current_org_id();
BEGIN
  RETURN jsonb_build_object(
    'server_now', now(),
    'day_start', CASE WHEN o IS NOT NULL THEN private.org_day_start(o) END,
    'timezone', COALESCE((SELECT timezone FROM public.organizations WHERE id = o), 'Europe/Lisbon')
  );
END; $$;
COMMENT ON FUNCTION public.org_clock() IS 'Authoritative server time, service-day start and timezone for the caller org.';
REVOKE ALL ON FUNCTION public.org_clock() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.org_clock() TO authenticated;

-- ---------- device: context (now includes server clock) ----------
CREATE OR REPLACE FUNCTION public.device_context(p_token uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE dev public.devices; org public.organizations; res jsonb;
BEGIN
  SELECT * INTO dev FROM public.devices WHERE token = p_token AND active = true;
  IF dev.id IS NULL THEN RETURN jsonb_build_object('error','invalid_token'); END IF;
  SELECT * INTO org FROM public.organizations WHERE id = dev.org_id;
  SELECT jsonb_build_object(
    'device', jsonb_build_object('id',dev.id,'name',dev.name,'type',dev.type),
    'org', jsonb_build_object('id',org.id,'name',org.name,'logo_url',org.logo_url,
      'primary_color',org.primary_color,'secondary_color',org.secondary_color,
      'modules_enabled',org.modules_enabled,'tv_config',org.tv_config,
      'kiosk_languages',org.kiosk_languages,'voice_lang',org.voice_lang,
      'timezone',org.timezone,'reset_time',org.reset_time),
    'server_now', now(),
    'day_start', private.org_day_start(org.id),
    'queues', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id',q.id,'name',q.name,'name_en',q.name_en,'prefix',q.prefix,'color',q.color,'icon',q.icon,
        'priority_enabled',q.priority_enabled,'avg_duration_minutes',q.avg_duration_minutes,'order',q."order",
        'waiting',(SELECT count(*) FROM public.tickets t WHERE t.queue_id=q.id AND t.status='em_espera' AND t.created_at >= private.org_day_start(org.id))
      ) ORDER BY q."order")
      FROM public.queues q WHERE q.org_id = org.id AND q.active = true), '[]'::jsonb)
  ) INTO res;
  RETURN res;
END; $$;
COMMENT ON FUNCTION public.device_context(uuid) IS 'Kiosk/TV bootstrap by device token: device, org branding/config, active queues with waiting counts, server clock. Public by design (token-gated).';

-- ---------- device: TV state ----------
CREATE OR REPLACE FUNCTION public.tv_state(p_token uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE dev public.devices; ds timestamptz; res jsonb;
BEGIN
  SELECT * INTO dev FROM public.devices WHERE token = p_token AND active = true;
  IF dev.id IS NULL THEN RETURN jsonb_build_object('error','invalid_token'); END IF;
  ds := private.org_day_start(dev.org_id);

  SELECT jsonb_build_object(
    'server_now', now(),
    'queues', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', q.id, 'name', q.name, 'name_en', q.name_en, 'color', q.color,
        'waiting', (SELECT count(*) FROM public.tickets t
                    WHERE t.queue_id=q.id AND t.status='em_espera' AND t.created_at >= ds),
        'current', (SELECT jsonb_build_object('full_ticket',t.full_ticket,'destination',
                      COALESCE((SELECT name FROM public.desks WHERE id=t.desk_id),
                               (SELECT name FROM public.cabinets WHERE id=t.cabinet_id)))
                    FROM public.tickets t
                    WHERE t.queue_id=q.id AND t.status IN ('chamado','em_atendimento') AND t.created_at >= ds
                    ORDER BY t.called_at DESC NULLS LAST LIMIT 1),
        'next', COALESCE((SELECT jsonb_agg(x.full_ticket) FROM (
                    SELECT t.full_ticket FROM public.tickets t
                    WHERE t.queue_id=q.id AND t.status='em_espera' AND t.created_at >= ds
                    ORDER BY t.priority DESC, t.sort_at ASC LIMIT 2) x), '[]'::jsonb)
      ) ORDER BY q."order")
      FROM public.queues q WHERE q.org_id = dev.org_id AND q.active = true), '[]'::jsonb),
    'recent_calls', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', l.id, 'full_ticket', l.full_ticket,
        'destination', COALESCE(l.desk_name, l.cabinet_name),
        'called_at', l.called_at, 'lang', COALESCE(t.lang_used,'pt')
      ) ORDER BY l.called_at DESC)
      FROM public.call_log l
      LEFT JOIN public.tickets t ON t.id = l.ticket_id
      WHERE l.org_id = dev.org_id AND l.called_at >= ds
      LIMIT 12), '[]'::jsonb)
  ) INTO res;
  RETURN res;
END; $$;
COMMENT ON FUNCTION public.tv_state(uuid) IS 'TV panel state by device token: per-queue current + next two tickets, recent calls, server clock. Never returns patient data.';
REVOKE ALL ON FUNCTION public.tv_state(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.tv_state(uuid) TO anon, authenticated;

-- ---------- kiosk: issue ticket (server clock, sort_at) ----------
CREATE OR REPLACE FUNCTION public.issue_ticket(p_token uuid, p_queue_id uuid, p_priority boolean DEFAULT false, p_lang text DEFAULT 'pt')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE dev public.devices; q public.queues; n int; t public.tickets; pos int; wait int; ds timestamptz;
BEGIN
  SELECT * INTO dev FROM public.devices WHERE token = p_token AND active = true;
  IF dev.id IS NULL THEN RETURN jsonb_build_object('error','invalid_token'); END IF;
  SELECT * INTO q FROM public.queues WHERE id = p_queue_id AND org_id = dev.org_id AND active = true;
  IF q.id IS NULL THEN RETURN jsonb_build_object('error','invalid_queue'); END IF;
  ds := private.org_day_start(dev.org_id);
  SELECT COALESCE(max(number),0)+1 INTO n FROM public.tickets
    WHERE queue_id = q.id AND created_at >= ds;
  INSERT INTO public.tickets (org_id, queue_id, number, full_ticket, priority, device_origin, lang_used, sort_at)
  VALUES (dev.org_id, q.id, n, q.prefix || '-' || lpad(n::text,3,'0'), COALESCE(p_priority,false), dev.type::text, COALESCE(p_lang,'pt'), now())
  RETURNING * INTO t;

  INSERT INTO public.ticket_events (org_id, ticket_id, full_ticket, event, device_id)
  VALUES (dev.org_id, t.id, t.full_ticket, 'emitida', dev.id);

  SELECT count(*) INTO pos FROM public.tickets w
    WHERE w.queue_id = q.id AND w.status = 'em_espera' AND w.created_at >= ds
      AND (w.priority > t.priority OR (w.priority = t.priority AND w.sort_at <= t.sort_at));
  wait := GREATEST(pos - 1, 0) * q.avg_duration_minutes;
  RETURN jsonb_build_object('ticket', to_jsonb(t), 'position', pos, 'wait_minutes', wait,
    'server_now', now(),
    'queue', jsonb_build_object('name',q.name,'name_en',q.name_en));
END; $$;
COMMENT ON FUNCTION public.issue_ticket(uuid,uuid,boolean,text) IS 'Kiosk ticket emission by device token: daily counter per queue from the org service day, logs the emission event. Public by design (token-gated).';

-- ---------- follow page ----------
CREATE OR REPLACE FUNCTION public.ticket_status(p_ticket_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE t public.tickets; q public.queues; org public.organizations; pos int; dest text;
BEGIN
  SELECT * INTO t FROM public.tickets WHERE id = p_ticket_id;
  IF t.id IS NULL THEN RETURN jsonb_build_object('error','not_found'); END IF;
  SELECT * INTO q FROM public.queues WHERE id = t.queue_id;
  SELECT * INTO org FROM public.organizations WHERE id = t.org_id;
  SELECT count(*) INTO pos FROM public.tickets w
    WHERE w.queue_id = t.queue_id AND w.status = 'em_espera' AND w.created_at >= private.org_day_start(t.org_id)
      AND (w.priority > t.priority OR (w.priority = t.priority AND w.sort_at <= t.sort_at));
  SELECT COALESCE((SELECT name FROM public.desks WHERE id = t.desk_id),(SELECT name FROM public.cabinets WHERE id = t.cabinet_id)) INTO dest;
  RETURN jsonb_build_object(
    'ticket', jsonb_build_object('id',t.id,'full_ticket',t.full_ticket,'status',t.status,'priority',t.priority,'lang_used',t.lang_used,'called_at',t.called_at),
    'queue', jsonb_build_object('name',q.name,'name_en',q.name_en,'avg_duration_minutes',q.avg_duration_minutes),
    'org', jsonb_build_object('name',org.name,'logo_url',org.logo_url,'primary_color',org.primary_color),
    'position', pos, 'destination', dest, 'server_now', now(),
    'wait_minutes', GREATEST(pos-1,0) * q.avg_duration_minutes);
END; $$;
COMMENT ON FUNCTION public.ticket_status(uuid) IS 'Follow-my-ticket data for the QR page. Returns no patient name or health number. Public by design (unguessable ticket id).';

-- ---------- staff: next ticket for a desk (ordered queue preference) ----------
CREATE OR REPLACE FUNCTION public.next_ticket_for_desk(p_desk_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE o uuid := private.current_org_id(); d public.desks; ds timestamptz; qid uuid; t public.tickets; idx int;
BEGIN
  IF o IS NULL THEN RETURN jsonb_build_object('error','no_access'); END IF;
  SELECT * INTO d FROM public.desks WHERE id = p_desk_id AND org_id = o AND active = true;
  IF d.id IS NULL THEN RETURN jsonb_build_object('error','invalid_desk'); END IF;
  ds := private.org_day_start(o);

  FOR qid, idx IN
    SELECT (value #>> '{}')::uuid, ordinality
    FROM jsonb_array_elements(d.queue_ids) WITH ORDINALITY AS e(value, ordinality)
  LOOP
    SELECT * INTO t FROM public.tickets
    WHERE queue_id = qid AND status = 'em_espera' AND created_at >= ds
    ORDER BY priority DESC, sort_at ASC LIMIT 1;
    IF t.id IS NOT NULL THEN
      RETURN jsonb_build_object('ticket', to_jsonb(t), 'server_now', now());
    END IF;
  END LOOP;

  IF jsonb_array_length(d.queue_ids) = 0 THEN
    SELECT * INTO t FROM public.tickets
    WHERE org_id = o AND status = 'em_espera' AND created_at >= ds
    ORDER BY priority DESC, sort_at ASC LIMIT 1;
    IF t.id IS NOT NULL THEN
      RETURN jsonb_build_object('ticket', to_jsonb(t), 'server_now', now());
    END IF;
  END IF;

  RETURN jsonb_build_object('ticket', NULL, 'server_now', now());
END; $$;
COMMENT ON FUNCTION public.next_ticket_for_desk(uuid) IS 'Next ticket a desk should call, following the desk queue preference order, then priority, then arrival.';
REVOKE ALL ON FUNCTION public.next_ticket_for_desk(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.next_ticket_for_desk(uuid) TO authenticated;

-- ---------- staff: skip with re-insertion ----------
CREATE OR REPLACE FUNCTION public.skip_ticket(p_ticket_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE o uuid := private.current_org_id(); t public.tickets; cfg public.organizations;
        ds timestamptz; anchor timestamptz; newskips int;
BEGIN
  IF o IS NULL THEN RETURN jsonb_build_object('error','no_access'); END IF;
  SELECT * INTO t FROM public.tickets WHERE id = p_ticket_id AND org_id = o;
  IF t.id IS NULL THEN RETURN jsonb_build_object('error','not_found'); END IF;
  SELECT * INTO cfg FROM public.organizations WHERE id = o;
  ds := private.org_day_start(o);
  newskips := t.skip_count + 1;

  IF newskips > GREATEST(cfg.max_skips, 1) THEN
    UPDATE public.tickets
      SET status = 'faltou', skip_count = newskips, last_skipped_at = now(), done_at = now()
      WHERE id = t.id;
    INSERT INTO public.ticket_events (org_id, ticket_id, full_ticket, event, actor_user_id, detail)
    VALUES (o, t.id, t.full_ticket, 'faltou', auth.uid(), jsonb_build_object('reason','max_skips','skip_count',newskips));
    RETURN jsonb_build_object('status','faltou','skip_count',newskips);
  END IF;

  SELECT sort_at INTO anchor FROM (
    SELECT w.sort_at FROM public.tickets w
    WHERE w.queue_id = t.queue_id AND w.status = 'em_espera' AND w.created_at >= ds AND w.id <> t.id
    ORDER BY w.priority DESC, w.sort_at ASC
    LIMIT GREATEST(cfg.skip_reinsert_after, 1)
  ) s ORDER BY sort_at DESC LIMIT 1;

  UPDATE public.tickets
    SET status = 'em_espera',
        skip_count = newskips,
        last_skipped_at = now(),
        sort_at = COALESCE(anchor, now()) + interval '1 second'
    WHERE id = t.id;

  INSERT INTO public.ticket_events (org_id, ticket_id, full_ticket, event, actor_user_id, detail)
  VALUES (o, t.id, t.full_ticket, 'saltada', auth.uid(),
          jsonb_build_object('skip_count',newskips,'reinsert_after',cfg.skip_reinsert_after));

  RETURN jsonb_build_object('status','em_espera','skip_count',newskips,
    'reinsert_after', cfg.skip_reinsert_after, 'max_skips', cfg.max_skips);
END; $$;
COMMENT ON FUNCTION public.skip_ticket(uuid) IS 'Skip a ticket: it returns to the queue after organizations.skip_reinsert_after tickets, keeping its priority. Past organizations.max_skips it becomes faltou. Every skip is logged.';
REVOKE ALL ON FUNCTION public.skip_ticket(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.skip_ticket(uuid) TO authenticated;

-- ---------- staff: recover a missed ticket ----------
CREATE OR REPLACE FUNCTION public.recover_ticket(p_ticket_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE o uuid := private.current_org_id(); t public.tickets; cfg public.organizations;
BEGIN
  IF o IS NULL THEN RETURN jsonb_build_object('error','no_access'); END IF;
  SELECT * INTO t FROM public.tickets WHERE id = p_ticket_id AND org_id = o;
  IF t.id IS NULL THEN RETURN jsonb_build_object('error','not_found'); END IF;
  IF t.status <> 'faltou' THEN RETURN jsonb_build_object('error','not_missed'); END IF;
  SELECT * INTO cfg FROM public.organizations WHERE id = o;
  IF COALESCE(t.done_at, t.created_at) < now() - make_interval(mins => GREATEST(cfg.missed_recovery_minutes,1)) THEN
    RETURN jsonb_build_object('error','recovery_expired');
  END IF;

  UPDATE public.tickets
    SET status = 'em_espera', done_at = NULL, skip_count = 0, sort_at = now()
    WHERE id = t.id;
  INSERT INTO public.ticket_events (org_id, ticket_id, full_ticket, event, actor_user_id)
  VALUES (o, t.id, t.full_ticket, 'recuperada', auth.uid());
  RETURN jsonb_build_object('status','em_espera');
END; $$;
COMMENT ON FUNCTION public.recover_ticket(uuid) IS 'Bring a faltou ticket back into the queue within organizations.missed_recovery_minutes. Logged as recuperada.';
REVOKE ALL ON FUNCTION public.recover_ticket(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.recover_ticket(uuid) TO authenticated;

-- ---------- stats: org ----------
CREATE OR REPLACE FUNCTION public.org_stats(p_from date, p_to date, p_org uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE o uuid; tz text; f timestamptz; t2 timestamptz;
BEGIN
  o := COALESCE(p_org, private.current_org_id());
  IF o IS NULL THEN RETURN jsonb_build_object('error','no_access'); END IF;
  IF NOT (private.is_super_admin() OR o = private.current_org_id()) THEN
    RETURN jsonb_build_object('error','forbidden');
  END IF;
  SELECT COALESCE(timezone,'Europe/Lisbon') INTO tz FROM public.organizations WHERE id = o;
  f := (p_from::timestamp) AT TIME ZONE tz;
  t2 := ((p_to + 1)::timestamp) AT TIME ZONE tz;

  RETURN jsonb_build_object(
    'server_now', now(),
    'totals', (SELECT jsonb_build_object(
        'tickets', count(*),
        'done', count(*) FILTER (WHERE status='concluido'),
        'missed', count(*) FILTER (WHERE status='faltou'),
        'waiting', count(*) FILTER (WHERE status='em_espera'),
        'avg_wait_minutes', COALESCE(round(avg(EXTRACT(EPOCH FROM (called_at - created_at))/60) FILTER (WHERE called_at IS NOT NULL))::int, 0),
        'avg_service_minutes', COALESCE(round(avg(EXTRACT(EPOCH FROM (done_at - called_at))/60) FILTER (WHERE done_at IS NOT NULL AND called_at IS NOT NULL))::int, 0)
      ) FROM public.tickets WHERE org_id=o AND created_at >= f AND created_at < t2),
    'by_day', COALESCE((SELECT jsonb_agg(x ORDER BY x->>'day') FROM (
        SELECT jsonb_build_object('day', to_char((created_at AT TIME ZONE tz)::date,'YYYY-MM-DD'),
          'tickets', count(*), 'missed', count(*) FILTER (WHERE status='faltou')) AS x
        FROM public.tickets WHERE org_id=o AND created_at >= f AND created_at < t2
        GROUP BY (created_at AT TIME ZONE tz)::date) s), '[]'::jsonb),
    'by_queue', COALESCE((SELECT jsonb_agg(x) FROM (
        SELECT jsonb_build_object('name', q.name, 'color', q.color, 'tickets', count(t.id),
          'avg_wait_minutes', COALESCE(round(avg(EXTRACT(EPOCH FROM (t.called_at - t.created_at))/60))::int,0)) AS x
        FROM public.queues q LEFT JOIN public.tickets t
          ON t.queue_id=q.id AND t.created_at >= f AND t.created_at < t2
        WHERE q.org_id=o GROUP BY q.id, q.name, q.color, q."order" ORDER BY q."order") s), '[]'::jsonb),
    'by_desk', COALESCE((SELECT jsonb_agg(x) FROM (
        SELECT jsonb_build_object('name', d.name, 'tickets', count(t.id)) AS x
        FROM public.desks d LEFT JOIN public.tickets t
          ON t.desk_id=d.id AND t.created_at >= f AND t.created_at < t2
        WHERE d.org_id=o GROUP BY d.id, d.name ORDER BY d.name) s), '[]'::jsonb),
    'by_hour', COALESCE((SELECT jsonb_agg(x ORDER BY (x->>'hour')::int) FROM (
        SELECT jsonb_build_object('hour', EXTRACT(HOUR FROM (created_at AT TIME ZONE tz))::int,
          'tickets', count(*)) AS x
        FROM public.tickets WHERE org_id=o AND created_at >= f AND created_at < t2
        GROUP BY EXTRACT(HOUR FROM (created_at AT TIME ZONE tz))) s), '[]'::jsonb)
  );
END; $$;
COMMENT ON FUNCTION public.org_stats(date,date,uuid) IS 'Clinic analytics for a date range in the org timezone: totals, per day, per queue, per desk, per hour. Org admins see their own org; super admins may pass p_org.';
REVOKE ALL ON FUNCTION public.org_stats(date,date,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.org_stats(date,date,uuid) TO authenticated;

-- ---------- stats: platform ----------
CREATE OR REPLACE FUNCTION public.platform_stats(p_from date, p_to date)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE f timestamptz; t2 timestamptz;
BEGIN
  IF NOT private.is_super_admin() THEN RETURN jsonb_build_object('error','forbidden'); END IF;
  f := (p_from::timestamp) AT TIME ZONE 'Europe/Lisbon';
  t2 := ((p_to + 1)::timestamp) AT TIME ZONE 'Europe/Lisbon';
  RETURN jsonb_build_object(
    'server_now', now(),
    'totals', jsonb_build_object(
      'orgs', (SELECT count(*) FROM public.organizations),
      'devices', (SELECT count(*) FROM public.devices WHERE active),
      'users', (SELECT count(*) FROM public.profiles WHERE active),
      'tickets', (SELECT count(*) FROM public.tickets WHERE created_at >= f AND created_at < t2)),
    'by_org', COALESCE((SELECT jsonb_agg(x) FROM (
        SELECT jsonb_build_object('name', o.name, 'plan', o.plan, 'tickets', count(t.id),
          'missed', count(t.id) FILTER (WHERE t.status='faltou')) AS x
        FROM public.organizations o LEFT JOIN public.tickets t
          ON t.org_id=o.id AND t.created_at >= f AND t.created_at < t2
        GROUP BY o.id, o.name, o.plan ORDER BY count(t.id) DESC) s), '[]'::jsonb),
    'by_day', COALESCE((SELECT jsonb_agg(x ORDER BY x->>'day') FROM (
        SELECT jsonb_build_object('day', to_char((created_at AT TIME ZONE 'Europe/Lisbon')::date,'YYYY-MM-DD'),
          'tickets', count(*)) AS x
        FROM public.tickets WHERE created_at >= f AND created_at < t2
        GROUP BY (created_at AT TIME ZONE 'Europe/Lisbon')::date) s), '[]'::jsonb)
  );
END; $$;
COMMENT ON FUNCTION public.platform_stats(date,date) IS 'Platform-wide analytics for the super admin: totals, per clinic and per day.';
REVOKE ALL ON FUNCTION public.platform_stats(date,date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.platform_stats(date,date) TO authenticated;

-- ---------- documentation on tables/columns ----------
COMMENT ON COLUMN public.organizations.skip_reinsert_after IS 'How many waiting tickets a skipped ticket falls behind before it is called again.';
COMMENT ON COLUMN public.organizations.max_skips IS 'Maximum skips before a ticket is automatically marked faltou.';
COMMENT ON COLUMN public.organizations.missed_recovery_minutes IS 'How long a faltou ticket can still be recovered by reception.';
COMMENT ON COLUMN public.tickets.sort_at IS 'Queue ordering key; changes when a ticket is skipped so it re-enters further back.';
COMMENT ON COLUMN public.tickets.skip_count IS 'Number of times this ticket was skipped.';
COMMENT ON COLUMN public.tickets.recall_count IS 'Number of times this ticket was re-called.';
COMMENT ON COLUMN public.desks.queue_ids IS 'Ordered list of queue ids this desk serves; order is the calling preference.';
COMMENT ON COLUMN public.cabinets.queue_ids IS 'Queues assigned to this cabinet; doctors only see tickets of these queues.';