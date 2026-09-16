CREATE SCHEMA IF NOT EXISTS private;
GRANT USAGE ON SCHEMA private TO authenticated, service_role;

CREATE OR REPLACE FUNCTION private.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role);
$$;
CREATE OR REPLACE FUNCTION private.is_super_admin()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'super_admin');
$$;
CREATE OR REPLACE FUNCTION private.current_org_id()
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT org_id FROM public.profiles WHERE id = auth.uid();
$$;
CREATE OR REPLACE FUNCTION private.can_manage_org_config()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role IN ('org_admin','chefe_turno','super_admin'));
$$;
CREATE OR REPLACE FUNCTION private.org_day_start(_org_id uuid)
RETURNS timestamptz LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE o public.organizations; d timestamptz; localnow timestamp;
BEGIN
  SELECT * INTO o FROM public.organizations WHERE id = _org_id;
  IF o.id IS NULL THEN RETURN now() - interval '1 day'; END IF;
  localnow := now() AT TIME ZONE o.timezone;
  d := ((localnow::date::text || ' ' || o.reset_time)::timestamp) AT TIME ZONE o.timezone;
  IF d > now() THEN d := d - interval '1 day'; END IF;
  RETURN d;
END; $$;

REVOKE ALL ON FUNCTION private.has_role(uuid, public.app_role) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.is_super_admin() FROM PUBLIC;
REVOKE ALL ON FUNCTION private.current_org_id() FROM PUBLIC;
REVOKE ALL ON FUNCTION private.can_manage_org_config() FROM PUBLIC;
REVOKE ALL ON FUNCTION private.org_day_start(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.has_role(uuid, public.app_role), private.is_super_admin(), private.current_org_id(), private.can_manage_org_config(), private.org_day_start(uuid) TO authenticated, service_role;

-- Recreate policies against private helpers
DROP POLICY org_select ON public.organizations;
DROP POLICY org_update ON public.organizations;
DROP POLICY org_insert ON public.organizations;
DROP POLICY org_delete ON public.organizations;
CREATE POLICY org_select ON public.organizations FOR SELECT TO authenticated USING (id = private.current_org_id() OR private.is_super_admin());
CREATE POLICY org_update ON public.organizations FOR UPDATE TO authenticated USING (private.is_super_admin() OR (id = private.current_org_id() AND private.has_role(auth.uid(),'org_admin')));
CREATE POLICY org_insert ON public.organizations FOR INSERT TO authenticated WITH CHECK (private.is_super_admin());
CREATE POLICY org_delete ON public.organizations FOR DELETE TO authenticated USING (private.is_super_admin());

DROP POLICY prof_self ON public.profiles;
DROP POLICY prof_update_self ON public.profiles;
DROP POLICY prof_insert ON public.profiles;
CREATE POLICY prof_self ON public.profiles FOR SELECT TO authenticated USING (id = auth.uid() OR org_id = private.current_org_id() OR private.is_super_admin());
CREATE POLICY prof_update_self ON public.profiles FOR UPDATE TO authenticated USING (id = auth.uid() OR private.is_super_admin() OR (org_id = private.current_org_id() AND private.has_role(auth.uid(),'org_admin')));
CREATE POLICY prof_insert ON public.profiles FOR INSERT TO authenticated WITH CHECK (id = auth.uid() OR private.is_super_admin() OR private.has_role(auth.uid(),'org_admin'));

DROP POLICY roles_select ON public.user_roles;
DROP POLICY roles_manage ON public.user_roles;
CREATE POLICY roles_select ON public.user_roles FOR SELECT TO authenticated USING (user_id = auth.uid() OR org_id = private.current_org_id() OR private.is_super_admin());
CREATE POLICY roles_manage ON public.user_roles FOR ALL TO authenticated USING (private.is_super_admin() OR (org_id = private.current_org_id() AND private.has_role(auth.uid(),'org_admin'))) WITH CHECK (private.is_super_admin() OR (org_id = private.current_org_id() AND private.has_role(auth.uid(),'org_admin')));

DROP POLICY q_select ON public.queues;
DROP POLICY q_manage ON public.queues;
CREATE POLICY q_select ON public.queues FOR SELECT TO authenticated USING (org_id = private.current_org_id() OR private.is_super_admin());
CREATE POLICY q_manage ON public.queues FOR ALL TO authenticated USING (private.can_manage_org_config() AND (org_id = private.current_org_id() OR private.is_super_admin())) WITH CHECK (private.can_manage_org_config() AND (org_id = private.current_org_id() OR private.is_super_admin()));

DROP POLICY d_select ON public.desks;
DROP POLICY d_manage ON public.desks;
CREATE POLICY d_select ON public.desks FOR SELECT TO authenticated USING (org_id = private.current_org_id() OR private.is_super_admin());
CREATE POLICY d_manage ON public.desks FOR ALL TO authenticated USING (private.can_manage_org_config() AND (org_id = private.current_org_id() OR private.is_super_admin())) WITH CHECK (private.can_manage_org_config() AND (org_id = private.current_org_id() OR private.is_super_admin()));

DROP POLICY c_select ON public.cabinets;
DROP POLICY c_manage ON public.cabinets;
CREATE POLICY c_select ON public.cabinets FOR SELECT TO authenticated USING (org_id = private.current_org_id() OR private.is_super_admin());
CREATE POLICY c_manage ON public.cabinets FOR ALL TO authenticated USING (private.can_manage_org_config() AND (org_id = private.current_org_id() OR private.is_super_admin())) WITH CHECK (private.can_manage_org_config() AND (org_id = private.current_org_id() OR private.is_super_admin()));

DROP POLICY dev_select ON public.devices;
DROP POLICY dev_manage ON public.devices;
CREATE POLICY dev_select ON public.devices FOR SELECT TO authenticated USING (org_id = private.current_org_id() OR private.is_super_admin());
CREATE POLICY dev_manage ON public.devices FOR ALL TO authenticated USING (private.is_super_admin() OR (org_id = private.current_org_id() AND private.has_role(auth.uid(),'org_admin'))) WITH CHECK (private.is_super_admin() OR (org_id = private.current_org_id() AND private.has_role(auth.uid(),'org_admin')));

DROP POLICY t_select ON public.tickets;
DROP POLICY t_insert ON public.tickets;
DROP POLICY t_update ON public.tickets;
DROP POLICY t_delete ON public.tickets;
CREATE POLICY t_select ON public.tickets FOR SELECT TO authenticated USING (org_id = private.current_org_id() OR private.is_super_admin());
CREATE POLICY t_insert ON public.tickets FOR INSERT TO authenticated WITH CHECK (org_id = private.current_org_id() OR private.is_super_admin());
CREATE POLICY t_update ON public.tickets FOR UPDATE TO authenticated USING (org_id = private.current_org_id() OR private.is_super_admin());
CREATE POLICY t_delete ON public.tickets FOR DELETE TO authenticated USING (private.can_manage_org_config() AND (org_id = private.current_org_id() OR private.is_super_admin()));

DROP POLICY cl_select ON public.call_log;
DROP POLICY cl_insert ON public.call_log;
CREATE POLICY cl_select ON public.call_log FOR SELECT TO authenticated USING (org_id = private.current_org_id() OR private.is_super_admin());
CREATE POLICY cl_insert ON public.call_log FOR INSERT TO authenticated WITH CHECK (org_id = private.current_org_id() OR private.is_super_admin());

-- Point public device RPCs at private.org_day_start, then drop public helpers
CREATE OR REPLACE FUNCTION public.device_context(p_token uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE dev public.devices; org public.organizations; res jsonb;
BEGIN
  SELECT * INTO dev FROM public.devices WHERE token = p_token AND active = true;
  IF dev.id IS NULL THEN RETURN jsonb_build_object('error','invalid_token'); END IF;
  SELECT * INTO org FROM public.organizations WHERE id = dev.org_id;
  SELECT jsonb_build_object(
    'device', jsonb_build_object('id',dev.id,'name',dev.name,'type',dev.type),
    'org', to_jsonb(org),
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

CREATE OR REPLACE FUNCTION public.issue_ticket(p_token uuid, p_queue_id uuid, p_priority boolean DEFAULT false, p_lang text DEFAULT 'pt')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE dev public.devices; q public.queues; n int; t public.tickets; pos int; wait int;
BEGIN
  SELECT * INTO dev FROM public.devices WHERE token = p_token AND active = true;
  IF dev.id IS NULL THEN RETURN jsonb_build_object('error','invalid_token'); END IF;
  SELECT * INTO q FROM public.queues WHERE id = p_queue_id AND org_id = dev.org_id AND active = true;
  IF q.id IS NULL THEN RETURN jsonb_build_object('error','invalid_queue'); END IF;
  SELECT COALESCE(max(number),0)+1 INTO n FROM public.tickets
    WHERE queue_id = q.id AND created_at >= private.org_day_start(dev.org_id);
  INSERT INTO public.tickets (org_id, queue_id, number, full_ticket, priority, device_origin, lang_used)
  VALUES (dev.org_id, q.id, n, q.prefix || '-' || lpad(n::text,3,'0'), COALESCE(p_priority,false), dev.type::text, COALESCE(p_lang,'pt'))
  RETURNING * INTO t;
  SELECT count(*) INTO pos FROM public.tickets w
    WHERE w.queue_id = q.id AND w.status = 'em_espera' AND w.created_at >= private.org_day_start(dev.org_id)
      AND (w.priority > t.priority OR (w.priority = t.priority AND w.created_at <= t.created_at));
  wait := GREATEST(pos - 1, 0) * q.avg_duration_minutes;
  RETURN jsonb_build_object('ticket', to_jsonb(t), 'position', pos, 'wait_minutes', wait,
    'queue', jsonb_build_object('name',q.name,'name_en',q.name_en));
END; $$;

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
      AND (w.priority > t.priority OR (w.priority = t.priority AND w.created_at <= t.created_at));
  SELECT COALESCE((SELECT name FROM public.desks WHERE id = t.desk_id),(SELECT name FROM public.cabinets WHERE id = t.cabinet_id)) INTO dest;
  RETURN jsonb_build_object(
    'ticket', jsonb_build_object('id',t.id,'full_ticket',t.full_ticket,'status',t.status,'priority',t.priority,'lang_used',t.lang_used,'called_at',t.called_at),
    'queue', jsonb_build_object('name',q.name,'name_en',q.name_en,'avg_duration_minutes',q.avg_duration_minutes),
    'org', jsonb_build_object('name',org.name,'logo_url',org.logo_url,'primary_color',org.primary_color),
    'position', pos, 'destination', dest,
    'wait_minutes', GREATEST(pos-1,0) * q.avg_duration_minutes);
END; $$;

DROP FUNCTION IF EXISTS public.has_role(uuid, public.app_role);
DROP FUNCTION IF EXISTS public.is_super_admin();
DROP FUNCTION IF EXISTS public.current_org_id();
DROP FUNCTION IF EXISTS public.can_manage_org_config();
DROP FUNCTION IF EXISTS public.org_day_start(uuid);

REVOKE ALL ON FUNCTION public.device_context(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.issue_ticket(uuid, uuid, boolean, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ticket_status(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.device_context(uuid), public.issue_ticket(uuid, uuid, boolean, text), public.ticket_status(uuid) TO anon, authenticated;
REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC;
