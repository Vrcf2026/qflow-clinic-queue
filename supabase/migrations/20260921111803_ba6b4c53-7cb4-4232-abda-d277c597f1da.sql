-- ============ immutable audit log ============

CREATE TABLE IF NOT EXISTS public.audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE,
  day_start timestamptz,
  entity text NOT NULL,
  entity_id uuid,
  entity_label text,
  action text NOT NULL,
  actor_user_id uuid,
  actor_name text,
  actor_email text,
  device_id uuid,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.audit_log TO authenticated;
GRANT ALL ON public.audit_log TO service_role;

ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;

-- Only managers read it; nobody can insert, update or delete from the app
-- (rows are written by SECURITY DEFINER triggers, which bypass RLS).
DROP POLICY IF EXISTS al_select ON public.audit_log;
CREATE POLICY al_select ON public.audit_log FOR SELECT TO authenticated
  USING (private.is_super_admin() OR (org_id = private.current_org_id() AND private.can_manage_org_config()));

CREATE INDEX IF NOT EXISTS idx_audit_org_time ON public.audit_log (org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_org_day ON public.audit_log (org_id, day_start);
CREATE INDEX IF NOT EXISTS idx_audit_entity ON public.audit_log (entity, entity_id);

COMMENT ON TABLE public.audit_log IS 'Immutable audit trail: who did what, when, in which clinic and service day. Written only by SECURITY DEFINER triggers; no insert/update/delete policies exist.';

-- ---------- writer ----------
CREATE OR REPLACE FUNCTION private.audit_write(
  p_org uuid, p_entity text, p_entity_id uuid, p_label text, p_action text,
  p_detail jsonb DEFAULT '{}'::jsonb, p_actor uuid DEFAULT NULL, p_device uuid DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE a uuid := COALESCE(p_actor, auth.uid()); nm text; em text;
BEGIN
  IF a IS NOT NULL THEN
    SELECT name, email INTO nm, em FROM public.profiles WHERE id = a;
  END IF;
  INSERT INTO public.audit_log (org_id, day_start, entity, entity_id, entity_label, action,
                                actor_user_id, actor_name, actor_email, device_id, detail)
  VALUES (p_org,
          CASE WHEN p_org IS NULL THEN NULL ELSE private.org_day_start(p_org) END,
          p_entity, p_entity_id, p_label, p_action, a, nm, em, p_device,
          COALESCE(p_detail, '{}'::jsonb));
END; $$;
REVOKE ALL ON FUNCTION private.audit_write(uuid,text,uuid,text,text,jsonb,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.audit_write(uuid,text,uuid,text,text,jsonb,uuid,uuid) TO service_role;

-- ---------- ticket actions: mirror every ticket_event ----------
CREATE OR REPLACE FUNCTION private.audit_ticket_event()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE t public.tickets; dest text;
BEGIN
  SELECT * INTO t FROM public.tickets WHERE id = NEW.ticket_id;
  SELECT COALESCE((SELECT name FROM public.desks WHERE id = t.desk_id),
                  (SELECT name FROM public.cabinets WHERE id = t.cabinet_id)) INTO dest;
  PERFORM private.audit_write(
    NEW.org_id, 'senha', NEW.ticket_id, NEW.full_ticket, NEW.event,
    NEW.detail || jsonb_strip_nulls(jsonb_build_object(
      'fila', (SELECT name FROM public.queues WHERE id = t.queue_id),
      'posto', dest,
      'prioritaria', t.priority,
      'estado', t.status)),
    NEW.actor_user_id, NEW.device_id);
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS audit_ticket_events ON public.ticket_events;
CREATE TRIGGER audit_ticket_events AFTER INSERT ON public.ticket_events
FOR EACH ROW EXECUTE FUNCTION private.audit_ticket_event();

-- ---------- configuration changes: queues, desks, cabinets ----------
CREATE OR REPLACE FUNCTION private.audit_config_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE ent text; o uuid; lbl text; det jsonb;
        keys text[] := ARRAY['name','active','queue_ids','queue_strategy','priority_ratio','order','avg_duration_minutes','prefix','color','priority_enabled','name_en'];
        k text; before jsonb := '{}'::jsonb; after jsonb := '{}'::jsonb;
BEGIN
  ent := CASE TG_TABLE_NAME WHEN 'queues' THEN 'fila' WHEN 'desks' THEN 'balcao' ELSE 'gabinete' END;

  IF TG_OP = 'DELETE' THEN
    PERFORM private.audit_write(OLD.org_id, ent, OLD.id, OLD.name, 'removido',
      jsonb_build_object('antes', to_jsonb(OLD)));
    RETURN OLD;
  END IF;

  o := NEW.org_id; lbl := NEW.name;

  IF TG_OP = 'INSERT' THEN
    PERFORM private.audit_write(o, ent, NEW.id, lbl, 'criado',
      jsonb_build_object('depois', to_jsonb(NEW)));
    RETURN NEW;
  END IF;

  FOREACH k IN ARRAY keys LOOP
    IF (to_jsonb(OLD) ? k) AND (to_jsonb(OLD)->k) IS DISTINCT FROM (to_jsonb(NEW)->k) THEN
      before := before || jsonb_build_object(k, to_jsonb(OLD)->k);
      after := after || jsonb_build_object(k, to_jsonb(NEW)->k);
    END IF;
  END LOOP;

  IF after = '{}'::jsonb THEN RETURN NEW; END IF;
  det := jsonb_build_object('antes', before, 'depois', after);
  PERFORM private.audit_write(o, ent, NEW.id, lbl, 'alterado', det);
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS audit_queues ON public.queues;
CREATE TRIGGER audit_queues AFTER INSERT OR UPDATE OR DELETE ON public.queues
FOR EACH ROW EXECUTE FUNCTION private.audit_config_change();

DROP TRIGGER IF EXISTS audit_desks ON public.desks;
CREATE TRIGGER audit_desks AFTER INSERT OR UPDATE OR DELETE ON public.desks
FOR EACH ROW EXECUTE FUNCTION private.audit_config_change();

DROP TRIGGER IF EXISTS audit_cabinets ON public.cabinets;
CREATE TRIGGER audit_cabinets AFTER INSERT OR UPDATE OR DELETE ON public.cabinets
FOR EACH ROW EXECUTE FUNCTION private.audit_config_change();

-- ---------- clinic configuration changes ----------
CREATE OR REPLACE FUNCTION private.audit_org_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE keys text[] := ARRAY['name','plan','modules_enabled','tv_config','kiosk_languages','voice_lang',
        'reset_time','timezone','skip_reinsert_after','max_skips','missed_recovery_minutes',
        'queue_strategy','priority_ratio','primary_color','secondary_color','logo_url'];
        k text; before jsonb := '{}'::jsonb; after jsonb := '{}'::jsonb;
BEGIN
  FOREACH k IN ARRAY keys LOOP
    IF (to_jsonb(OLD)->k) IS DISTINCT FROM (to_jsonb(NEW)->k) THEN
      before := before || jsonb_build_object(k, to_jsonb(OLD)->k);
      after := after || jsonb_build_object(k, to_jsonb(NEW)->k);
    END IF;
  END LOOP;
  IF after = '{}'::jsonb THEN RETURN NEW; END IF;
  PERFORM private.audit_write(NEW.id, 'clinica', NEW.id, NEW.name, 'configuracao_alterada',
    jsonb_build_object('antes', before, 'depois', after));
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS audit_organizations ON public.organizations;
CREATE TRIGGER audit_organizations AFTER UPDATE ON public.organizations
FOR EACH ROW EXECUTE FUNCTION private.audit_org_change();

-- ---------- reader: filters by clinic, service day and entity ----------
CREATE OR REPLACE FUNCTION public.audit_trail(
  p_from date DEFAULT NULL, p_to date DEFAULT NULL, p_org uuid DEFAULT NULL,
  p_entity text DEFAULT NULL, p_action text DEFAULT NULL, p_limit int DEFAULT 200)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE o uuid; tz text; f timestamptz; t2 timestamptz; lim int := LEAST(GREATEST(COALESCE(p_limit,200),1), 1000);
BEGIN
  IF private.is_super_admin() THEN
    o := p_org;  -- NULL = every clinic
  ELSE
    o := private.current_org_id();
    IF o IS NULL OR NOT private.can_manage_org_config() THEN
      RETURN jsonb_build_object('error','forbidden');
    END IF;
    IF p_org IS NOT NULL AND p_org <> o THEN RETURN jsonb_build_object('error','forbidden'); END IF;
  END IF;

  SELECT COALESCE(timezone,'Europe/Lisbon') INTO tz FROM public.organizations WHERE id = COALESCE(o, p_org);
  tz := COALESCE(tz, 'Europe/Lisbon');
  f := CASE WHEN p_from IS NULL THEN NULL ELSE (p_from::timestamp) AT TIME ZONE tz END;
  t2 := CASE WHEN p_to IS NULL THEN NULL ELSE ((p_to + 1)::timestamp) AT TIME ZONE tz END;

  RETURN jsonb_build_object(
    'server_now', now(),
    'entries', COALESCE((
      SELECT jsonb_agg(x ORDER BY x->>'created_at' DESC) FROM (
        SELECT jsonb_build_object(
          'id', a.id, 'created_at', a.created_at, 'day_start', a.day_start,
          'org_id', a.org_id, 'org_name', og.name,
          'entity', a.entity, 'entity_id', a.entity_id, 'entity_label', a.entity_label,
          'action', a.action, 'actor_name', a.actor_name, 'actor_email', a.actor_email,
          'device_id', a.device_id, 'detail', a.detail) AS x
        FROM public.audit_log a
        LEFT JOIN public.organizations og ON og.id = a.org_id
        WHERE (o IS NULL OR a.org_id = o)
          AND (f IS NULL OR a.created_at >= f)
          AND (t2 IS NULL OR a.created_at < t2)
          AND (p_entity IS NULL OR a.entity = p_entity)
          AND (p_action IS NULL OR a.action = p_action)
        ORDER BY a.created_at DESC
        LIMIT lim) s), '[]'::jsonb)
  );
END; $$;
COMMENT ON FUNCTION public.audit_trail(date,date,uuid,text,text,int) IS 'Reads the audit trail. Shift lead / org admin see their own clinic; super admin sees every clinic.';
REVOKE ALL ON FUNCTION public.audit_trail(date,date,uuid,text,text,int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.audit_trail(date,date,uuid,text,text,int) TO authenticated;