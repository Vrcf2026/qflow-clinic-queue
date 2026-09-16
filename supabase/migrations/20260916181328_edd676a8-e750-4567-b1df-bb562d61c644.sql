-- ENUMS
CREATE TYPE public.app_role AS ENUM ('super_admin','org_admin','chefe_turno','rececionista','medico');
CREATE TYPE public.ticket_status AS ENUM ('em_espera','chamado','em_atendimento','concluido','faltou');
CREATE TYPE public.device_type AS ENUM ('quiosque','tv');
CREATE TYPE public.org_plan AS ENUM ('starter','pro','enterprise');

-- ORGANIZATIONS
CREATE TABLE public.organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text UNIQUE NOT NULL,
  logo_url text,
  primary_color text NOT NULL DEFAULT '#1a6fc4',
  secondary_color text NOT NULL DEFAULT '#07101f',
  plan public.org_plan NOT NULL DEFAULT 'starter',
  modules_enabled jsonb NOT NULL DEFAULT '{"kiosk":true,"tv":true,"recepcao":true,"gabinetes":true,"iptv":false,"sms":false,"prioritarios":true,"multi_balcao":true}'::jsonb,
  tv_config jsonb NOT NULL DEFAULT '{"stream_url":"","m3u_url":"","active_channel":"","layout":"video_esquerda","video_ratio":65,"volume":0.5,"silenciar_em_chamada":true}'::jsonb,
  kiosk_languages jsonb NOT NULL DEFAULT '{"pt":true,"en":false}'::jsonb,
  voice_lang text NOT NULL DEFAULT 'pt',
  reset_time text NOT NULL DEFAULT '08:00',
  timezone text NOT NULL DEFAULT 'Europe/Lisbon',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.profiles (
  id uuid PRIMARY KEY,
  org_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE,
  name text NOT NULL DEFAULT '',
  email text NOT NULL DEFAULT '',
  desk_id uuid,
  cabinet_id uuid,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  org_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  UNIQUE (user_id, role)
);

CREATE TABLE public.queues (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  name_en text,
  prefix text NOT NULL,
  color text NOT NULL DEFAULT '#1a6fc4',
  icon text NOT NULL DEFAULT 'stethoscope',
  priority_enabled boolean NOT NULL DEFAULT true,
  active boolean NOT NULL DEFAULT true,
  "order" int NOT NULL DEFAULT 0,
  avg_duration_minutes int NOT NULL DEFAULT 10,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.desks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  queue_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.cabinets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  queue_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.devices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  type public.device_type NOT NULL,
  token uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.tickets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  queue_id uuid NOT NULL REFERENCES public.queues(id) ON DELETE CASCADE,
  number int NOT NULL,
  full_ticket text NOT NULL,
  priority boolean NOT NULL DEFAULT false,
  status public.ticket_status NOT NULL DEFAULT 'em_espera',
  patient_name text,
  patient_utente text,
  desk_id uuid REFERENCES public.desks(id) ON DELETE SET NULL,
  cabinet_id uuid REFERENCES public.cabinets(id) ON DELETE SET NULL,
  device_origin text NOT NULL DEFAULT 'quiosque',
  lang_used text NOT NULL DEFAULT 'pt',
  created_at timestamptz NOT NULL DEFAULT now(),
  called_at timestamptz,
  done_at timestamptz
);

CREATE TABLE public.call_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  ticket_id uuid REFERENCES public.tickets(id) ON DELETE CASCADE,
  full_ticket text NOT NULL,
  called_by_user_id uuid,
  called_by_device_id uuid,
  desk_name text,
  cabinet_name text,
  called_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_tickets_org_created ON public.tickets (org_id, created_at DESC);
CREATE INDEX idx_tickets_queue_status ON public.tickets (queue_id, status);
CREATE INDEX idx_call_log_org ON public.call_log (org_id, called_at DESC);

-- HELPERS
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role);
$$;

CREATE OR REPLACE FUNCTION public.is_super_admin()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.has_role(auth.uid(), 'super_admin');
$$;

CREATE OR REPLACE FUNCTION public.current_org_id()
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT org_id FROM public.profiles WHERE id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION public.can_manage_org_config()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.has_role(auth.uid(),'org_admin') OR public.has_role(auth.uid(),'chefe_turno') OR public.has_role(auth.uid(),'super_admin');
$$;

CREATE OR REPLACE FUNCTION public.org_day_start(_org_id uuid)
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

-- NEW USER TRIGGER
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, name, email)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'name', split_part(NEW.email,'@',1)), COALESCE(NEW.email,''))
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END; $$;

CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- GRANTS
GRANT SELECT, INSERT, UPDATE, DELETE ON public.organizations, public.profiles, public.user_roles, public.queues, public.desks, public.cabinets, public.devices, public.tickets, public.call_log TO authenticated;
GRANT ALL ON public.organizations, public.profiles, public.user_roles, public.queues, public.desks, public.cabinets, public.devices, public.tickets, public.call_log TO service_role;

-- anon: read-only, no patient data
GRANT SELECT (id, name, slug, logo_url, primary_color, secondary_color, modules_enabled, tv_config, kiosk_languages, voice_lang, timezone) ON public.organizations TO anon;
GRANT SELECT (id, org_id, name, name_en, prefix, color, icon, priority_enabled, active, "order", avg_duration_minutes) ON public.queues TO anon;
GRANT SELECT (id, org_id, name, active) ON public.desks TO anon;
GRANT SELECT (id, org_id, name, active) ON public.cabinets TO anon;
GRANT SELECT (id, org_id, queue_id, number, full_ticket, priority, status, desk_id, cabinet_id, lang_used, created_at, called_at, done_at) ON public.tickets TO anon;
GRANT SELECT (id, org_id, ticket_id, full_ticket, desk_name, cabinet_name, called_at) ON public.call_log TO anon;

ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.queues ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.desks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cabinets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.call_log ENABLE ROW LEVEL SECURITY;

-- ORGANIZATIONS
CREATE POLICY org_select ON public.organizations FOR SELECT TO authenticated USING (id = public.current_org_id() OR public.is_super_admin());
CREATE POLICY org_public_select ON public.organizations FOR SELECT TO anon USING (true);
CREATE POLICY org_update ON public.organizations FOR UPDATE TO authenticated USING (public.is_super_admin() OR (id = public.current_org_id() AND public.has_role(auth.uid(),'org_admin')));
CREATE POLICY org_insert ON public.organizations FOR INSERT TO authenticated WITH CHECK (public.is_super_admin());
CREATE POLICY org_delete ON public.organizations FOR DELETE TO authenticated USING (public.is_super_admin());

-- PROFILES
CREATE POLICY prof_self ON public.profiles FOR SELECT TO authenticated USING (id = auth.uid() OR org_id = public.current_org_id() OR public.is_super_admin());
CREATE POLICY prof_update_self ON public.profiles FOR UPDATE TO authenticated USING (id = auth.uid() OR public.is_super_admin() OR (org_id = public.current_org_id() AND public.has_role(auth.uid(),'org_admin')));
CREATE POLICY prof_insert ON public.profiles FOR INSERT TO authenticated WITH CHECK (id = auth.uid() OR public.is_super_admin() OR public.has_role(auth.uid(),'org_admin'));

-- USER ROLES
CREATE POLICY roles_select ON public.user_roles FOR SELECT TO authenticated USING (user_id = auth.uid() OR org_id = public.current_org_id() OR public.is_super_admin());
CREATE POLICY roles_manage ON public.user_roles FOR ALL TO authenticated USING (public.is_super_admin() OR (org_id = public.current_org_id() AND public.has_role(auth.uid(),'org_admin'))) WITH CHECK (public.is_super_admin() OR (org_id = public.current_org_id() AND public.has_role(auth.uid(),'org_admin')));

-- QUEUES / DESKS / CABINETS
CREATE POLICY q_select ON public.queues FOR SELECT TO authenticated USING (org_id = public.current_org_id() OR public.is_super_admin());
CREATE POLICY q_public ON public.queues FOR SELECT TO anon USING (true);
CREATE POLICY q_manage ON public.queues FOR ALL TO authenticated USING (public.can_manage_org_config() AND (org_id = public.current_org_id() OR public.is_super_admin())) WITH CHECK (public.can_manage_org_config() AND (org_id = public.current_org_id() OR public.is_super_admin()));

CREATE POLICY d_select ON public.desks FOR SELECT TO authenticated USING (org_id = public.current_org_id() OR public.is_super_admin());
CREATE POLICY d_public ON public.desks FOR SELECT TO anon USING (true);
CREATE POLICY d_manage ON public.desks FOR ALL TO authenticated USING (public.can_manage_org_config() AND (org_id = public.current_org_id() OR public.is_super_admin())) WITH CHECK (public.can_manage_org_config() AND (org_id = public.current_org_id() OR public.is_super_admin()));

CREATE POLICY c_select ON public.cabinets FOR SELECT TO authenticated USING (org_id = public.current_org_id() OR public.is_super_admin());
CREATE POLICY c_public ON public.cabinets FOR SELECT TO anon USING (true);
CREATE POLICY c_manage ON public.cabinets FOR ALL TO authenticated USING (public.can_manage_org_config() AND (org_id = public.current_org_id() OR public.is_super_admin())) WITH CHECK (public.can_manage_org_config() AND (org_id = public.current_org_id() OR public.is_super_admin()));

-- DEVICES (no anon read; tokens are secret)
CREATE POLICY dev_select ON public.devices FOR SELECT TO authenticated USING (org_id = public.current_org_id() OR public.is_super_admin());
CREATE POLICY dev_manage ON public.devices FOR ALL TO authenticated USING (public.is_super_admin() OR (org_id = public.current_org_id() AND public.has_role(auth.uid(),'org_admin'))) WITH CHECK (public.is_super_admin() OR (org_id = public.current_org_id() AND public.has_role(auth.uid(),'org_admin')));

-- TICKETS
CREATE POLICY t_select ON public.tickets FOR SELECT TO authenticated USING (org_id = public.current_org_id() OR public.is_super_admin());
CREATE POLICY t_public ON public.tickets FOR SELECT TO anon USING (true);
CREATE POLICY t_insert ON public.tickets FOR INSERT TO authenticated WITH CHECK (org_id = public.current_org_id() OR public.is_super_admin());
CREATE POLICY t_update ON public.tickets FOR UPDATE TO authenticated USING (org_id = public.current_org_id() OR public.is_super_admin());
CREATE POLICY t_delete ON public.tickets FOR DELETE TO authenticated USING (public.can_manage_org_config() AND (org_id = public.current_org_id() OR public.is_super_admin()));

-- CALL LOG
CREATE POLICY cl_select ON public.call_log FOR SELECT TO authenticated USING (org_id = public.current_org_id() OR public.is_super_admin());
CREATE POLICY cl_public ON public.call_log FOR SELECT TO anon USING (true);
CREATE POLICY cl_insert ON public.call_log FOR INSERT TO authenticated WITH CHECK (org_id = public.current_org_id() OR public.is_super_admin());

-- DEVICE RPCS (anon, token based)
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
        'waiting',(SELECT count(*) FROM public.tickets t WHERE t.queue_id=q.id AND t.status='em_espera' AND t.created_at >= public.org_day_start(org.id))
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
    WHERE queue_id = q.id AND created_at >= public.org_day_start(dev.org_id);
  INSERT INTO public.tickets (org_id, queue_id, number, full_ticket, priority, device_origin, lang_used)
  VALUES (dev.org_id, q.id, n, q.prefix || '-' || lpad(n::text,3,'0'), COALESCE(p_priority,false), dev.type::text, COALESCE(p_lang,'pt'))
  RETURNING * INTO t;
  SELECT count(*) INTO pos FROM public.tickets w
    WHERE w.queue_id = q.id AND w.status = 'em_espera' AND w.created_at >= public.org_day_start(dev.org_id)
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
    WHERE w.queue_id = t.queue_id AND w.status = 'em_espera' AND w.created_at >= public.org_day_start(t.org_id)
      AND (w.priority > t.priority OR (w.priority = t.priority AND w.created_at <= t.created_at));
  SELECT COALESCE((SELECT name FROM public.desks WHERE id = t.desk_id),(SELECT name FROM public.cabinets WHERE id = t.cabinet_id)) INTO dest;
  RETURN jsonb_build_object(
    'ticket', jsonb_build_object('id',t.id,'full_ticket',t.full_ticket,'status',t.status,'priority',t.priority,'lang_used',t.lang_used,'called_at',t.called_at),
    'queue', jsonb_build_object('name',q.name,'name_en',q.name_en,'avg_duration_minutes',q.avg_duration_minutes),
    'org', jsonb_build_object('name',org.name,'logo_url',org.logo_url,'primary_color',org.primary_color),
    'position', pos, 'destination', dest,
    'wait_minutes', GREATEST(pos-1,0) * q.avg_duration_minutes);
END; $$;

GRANT EXECUTE ON FUNCTION public.device_context(uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_ticket(uuid, uuid, boolean, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ticket_status(uuid) TO anon, authenticated;

-- REALTIME
ALTER TABLE public.tickets REPLICA IDENTITY FULL;
ALTER TABLE public.call_log REPLICA IDENTITY FULL;
ALTER TABLE public.queues REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE public.tickets;
ALTER PUBLICATION supabase_realtime ADD TABLE public.call_log;
ALTER PUBLICATION supabase_realtime ADD TABLE public.queues;

-- DEMO SEED
INSERT INTO public.organizations (id, name, slug, primary_color, kiosk_languages, modules_enabled)
VALUES ('11111111-1111-1111-1111-111111111111','Clínica Demo','clinica-demo','#1a6fc4','{"pt":true,"en":true}'::jsonb,
'{"kiosk":true,"tv":true,"recepcao":true,"gabinetes":true,"iptv":true,"sms":false,"prioritarios":true,"multi_balcao":true}'::jsonb);

INSERT INTO public.queues (id, org_id, name, name_en, prefix, color, icon, "order", avg_duration_minutes) VALUES
('21111111-1111-1111-1111-111111111111','11111111-1111-1111-1111-111111111111','Consultas','Appointments','C','#1a6fc4','stethoscope',1,12),
('22222222-2222-2222-2222-222222222222','11111111-1111-1111-1111-111111111111','Exames','Exams','E','#0e9488','activity',2,20),
('23333333-3333-3333-3333-333333333333','11111111-1111-1111-1111-111111111111','Análises','Blood tests','A','#b45309','syringe',3,8),
('24444444-4444-4444-4444-444444444444','11111111-1111-1111-1111-111111111111','Receção','Front desk','R','#7c3aed','clipboard',4,5);

INSERT INTO public.desks (id, org_id, name, queue_ids) VALUES
('31111111-1111-1111-1111-111111111111','11111111-1111-1111-1111-111111111111','Balcão 1','["21111111-1111-1111-1111-111111111111","24444444-4444-4444-4444-444444444444"]'::jsonb),
('32222222-2222-2222-2222-222222222222','11111111-1111-1111-1111-111111111111','Balcão 2','["22222222-2222-2222-2222-222222222222","23333333-3333-3333-3333-333333333333"]'::jsonb);

INSERT INTO public.cabinets (id, org_id, name, queue_ids) VALUES
('41111111-1111-1111-1111-111111111111','11111111-1111-1111-1111-111111111111','Gabinete 1 | Dr. Silva','["21111111-1111-1111-1111-111111111111"]'::jsonb),
('42222222-2222-2222-2222-222222222222','11111111-1111-1111-1111-111111111111','Gabinete 2 | Dra. Costa','["22222222-2222-2222-2222-222222222222"]'::jsonb);

INSERT INTO public.devices (id, org_id, name, type, token) VALUES
('51111111-1111-1111-1111-111111111111','11111111-1111-1111-1111-111111111111','Quiosque Entrada','quiosque','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
('52222222-2222-2222-2222-222222222222','11111111-1111-1111-1111-111111111111','TV Sala de Espera','tv','bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');
