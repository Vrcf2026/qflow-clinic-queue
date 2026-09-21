-- ============ queue ordering strategy: org default + per desk/cabinet ============

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS queue_strategy text NOT NULL DEFAULT 'prioridade',
  ADD COLUMN IF NOT EXISTS priority_ratio jsonb NOT NULL DEFAULT '{"priority":2,"normal":1}'::jsonb;

ALTER TABLE public.desks
  ADD COLUMN IF NOT EXISTS queue_strategy text,
  ADD COLUMN IF NOT EXISTS priority_ratio jsonb;

ALTER TABLE public.cabinets
  ADD COLUMN IF NOT EXISTS queue_strategy text,
  ADD COLUMN IF NOT EXISTS priority_ratio jsonb;

DO $$ BEGIN
  ALTER TABLE public.organizations ADD CONSTRAINT organizations_queue_strategy_chk
    CHECK (queue_strategy IN ('chegada','prioridade','alternado','duracao'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.desks ADD CONSTRAINT desks_queue_strategy_chk
    CHECK (queue_strategy IS NULL OR queue_strategy IN ('chegada','prioridade','alternado','duracao'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.cabinets ADD CONSTRAINT cabinets_queue_strategy_chk
    CHECK (queue_strategy IS NULL OR queue_strategy IN ('chegada','prioridade','alternado','duracao'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

COMMENT ON COLUMN public.organizations.queue_strategy IS 'Default calling rule for the clinic: chegada | prioridade | alternado | duracao.';
COMMENT ON COLUMN public.organizations.priority_ratio IS 'Priority:normal ratio used by the alternado rule, e.g. {"priority":2,"normal":1}.';
COMMENT ON COLUMN public.desks.queue_strategy IS 'Per-desk calling rule; NULL inherits the clinic default.';
COMMENT ON COLUMN public.cabinets.queue_strategy IS 'Per-cabinet calling rule; NULL inherits the clinic default.';

-- ---------- effective strategy for a post ----------
CREATE OR REPLACE FUNCTION private.effective_strategy(p_org uuid, p_desk uuid DEFAULT NULL, p_cabinet uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE org public.organizations; s text; r jsonb;
BEGIN
  SELECT * INTO org FROM public.organizations WHERE id = p_org;
  IF org.id IS NULL THEN RETURN jsonb_build_object('strategy','prioridade','priority',2,'normal',1); END IF;
  s := org.queue_strategy; r := org.priority_ratio;
  IF p_desk IS NOT NULL THEN
    SELECT COALESCE(d.queue_strategy, s), COALESCE(d.priority_ratio, r) INTO s, r
    FROM public.desks d WHERE d.id = p_desk AND d.org_id = p_org;
  ELSIF p_cabinet IS NOT NULL THEN
    SELECT COALESCE(c.queue_strategy, s), COALESCE(c.priority_ratio, r) INTO s, r
    FROM public.cabinets c WHERE c.id = p_cabinet AND c.org_id = p_org;
  END IF;
  RETURN jsonb_build_object(
    'strategy', COALESCE(s,'prioridade'),
    'priority', GREATEST(COALESCE((r->>'priority')::int, 2), 1),
    'normal', GREATEST(COALESCE((r->>'normal')::int, 1), 1));
END; $$;
COMMENT ON FUNCTION private.effective_strategy(uuid,uuid,uuid) IS 'Calling rule in force for a post: the desk/cabinet override when set, otherwise the clinic default.';
REVOKE ALL ON FUNCTION private.effective_strategy(uuid,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.effective_strategy(uuid,uuid,uuid) TO authenticated, service_role;

-- ---------- next ticket following a strategy ----------
CREATE OR REPLACE FUNCTION private.pick_next(p_org uuid, p_queue_ids jsonb, p_desk uuid DEFAULT NULL, p_cabinet uuid DEFAULT NULL)
RETURNS public.tickets LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE ds timestamptz := private.org_day_start(p_org);
        cfg jsonb := private.effective_strategy(p_org, p_desk, p_cabinet);
        strat text := cfg->>'strategy';
        nprio int := (cfg->>'priority')::int;
        nnorm int := (cfg->>'normal')::int;
        ids uuid[]; qid uuid; t public.tickets; done int; want boolean; pass int;
BEGIN
  IF p_queue_ids IS NULL OR jsonb_array_length(p_queue_ids) = 0 THEN
    SELECT array_agg(id ORDER BY "order") INTO ids
    FROM public.queues WHERE org_id = p_org AND active = true;
  ELSE
    SELECT array_agg((value #>> '{}')::uuid ORDER BY ordinality) INTO ids
    FROM jsonb_array_elements(p_queue_ids) WITH ORDINALITY AS e(value, ordinality);
  END IF;
  IF ids IS NULL OR array_length(ids,1) IS NULL THEN RETURN NULL; END IF;

  IF strat = 'duracao' THEN
    SELECT t2.* INTO t FROM public.tickets t2
      JOIN public.queues q ON q.id = t2.queue_id
     WHERE t2.queue_id = ANY(ids) AND t2.status = 'em_espera' AND t2.created_at >= ds
     ORDER BY q.avg_duration_minutes ASC, t2.priority DESC, t2.sort_at ASC
     LIMIT 1;
    RETURN t;
  END IF;

  IF strat = 'alternado' THEN
    SELECT count(*) INTO done FROM public.tickets x
     WHERE x.org_id = p_org AND x.called_at >= ds
       AND ((p_desk IS NOT NULL AND x.desk_id = p_desk)
         OR (p_cabinet IS NOT NULL AND x.cabinet_id = p_cabinet)
         OR (p_desk IS NULL AND p_cabinet IS NULL));
    want := (done % (nprio + nnorm)) < nprio;  -- first nprio of each cycle go to priority
    FOR pass IN 1..2 LOOP
      FOREACH qid IN ARRAY ids LOOP
        SELECT * INTO t FROM public.tickets
         WHERE queue_id = qid AND status = 'em_espera' AND created_at >= ds
           AND (pass = 2 OR priority = want)
         ORDER BY sort_at ASC LIMIT 1;
        IF t.id IS NOT NULL THEN RETURN t; END IF;
      END LOOP;
    END LOOP;
    RETURN NULL;
  END IF;

  -- chegada (pure arrival) and prioridade (priority first), respecting queue preference order
  FOREACH qid IN ARRAY ids LOOP
    IF strat = 'chegada' THEN
      SELECT * INTO t FROM public.tickets
       WHERE queue_id = qid AND status = 'em_espera' AND created_at >= ds
       ORDER BY sort_at ASC LIMIT 1;
    ELSE
      SELECT * INTO t FROM public.tickets
       WHERE queue_id = qid AND status = 'em_espera' AND created_at >= ds
       ORDER BY priority DESC, sort_at ASC LIMIT 1;
    END IF;
    IF t.id IS NOT NULL THEN RETURN t; END IF;
  END LOOP;

  RETURN NULL;
END; $$;
COMMENT ON FUNCTION private.pick_next(uuid,jsonb,uuid,uuid) IS 'Next waiting ticket for a post, applying the effective calling rule (arrival, priority first, alternating ratio, shortest average service).';
REVOKE ALL ON FUNCTION private.pick_next(uuid,jsonb,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.pick_next(uuid,jsonb,uuid,uuid) TO authenticated, service_role;

-- ---------- staff: change the clinic rule (shift lead and above) ----------
CREATE OR REPLACE FUNCTION public.set_queue_strategy(p_strategy text, p_ratio jsonb DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE o uuid := private.current_org_id(); pr int; nr int;
BEGIN
  IF o IS NULL THEN RETURN jsonb_build_object('error','no_access'); END IF;
  IF NOT private.can_manage_org_config() THEN RETURN jsonb_build_object('error','forbidden'); END IF;
  IF p_strategy NOT IN ('chegada','prioridade','alternado','duracao') THEN
    RETURN jsonb_build_object('error','invalid_strategy');
  END IF;
  pr := GREATEST(COALESCE((p_ratio->>'priority')::int, 2), 1);
  nr := GREATEST(COALESCE((p_ratio->>'normal')::int, 1), 1);
  UPDATE public.organizations
     SET queue_strategy = p_strategy,
         priority_ratio = jsonb_build_object('priority', pr, 'normal', nr)
   WHERE id = o;
  RETURN jsonb_build_object('status','ok','strategy',p_strategy,'priority',pr,'normal',nr,'server_now',now());
END; $$;
COMMENT ON FUNCTION public.set_queue_strategy(text,jsonb) IS 'Sets the clinic default calling rule and priority ratio. Allowed for shift lead, org admin and super admin only.';
REVOKE ALL ON FUNCTION public.set_queue_strategy(text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_queue_strategy(text,jsonb) TO authenticated;

-- ---------- next ticket for a post ----------
CREATE OR REPLACE FUNCTION public.next_ticket_for_desk(p_desk_id uuid, p_cabinet_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE o uuid := private.current_org_id(); qids jsonb; t public.tickets; cfg jsonb;
BEGIN
  IF o IS NULL THEN RETURN jsonb_build_object('error','no_access'); END IF;
  IF p_desk_id IS NOT NULL THEN
    SELECT queue_ids INTO qids FROM public.desks WHERE id = p_desk_id AND org_id = o AND active = true;
    IF qids IS NULL THEN RETURN jsonb_build_object('error','invalid_desk'); END IF;
  ELSIF p_cabinet_id IS NOT NULL THEN
    SELECT queue_ids INTO qids FROM public.cabinets WHERE id = p_cabinet_id AND org_id = o AND active = true;
    IF qids IS NULL THEN RETURN jsonb_build_object('error','invalid_desk'); END IF;
  ELSE
    qids := '[]'::jsonb;
  END IF;

  cfg := private.effective_strategy(o, p_desk_id, p_cabinet_id);
  t := private.pick_next(o, qids, p_desk_id, p_cabinet_id);
  IF t.id IS NOT NULL AND NOT private.ticket_queue_visible(t.queue_id) THEN t := NULL; END IF;
  RETURN jsonb_build_object('ticket', CASE WHEN t.id IS NULL THEN NULL ELSE to_jsonb(t) END,
    'strategy', cfg, 'server_now', now());
END; $$;
COMMENT ON FUNCTION public.next_ticket_for_desk(uuid,uuid) IS 'Next ticket a desk/cabinet should call: queue preference order plus the effective calling rule for that post.';
REVOKE ALL ON FUNCTION public.next_ticket_for_desk(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.next_ticket_for_desk(uuid,uuid) TO authenticated;

-- ---------- kiosk: position aware of the clinic rule ----------
CREATE OR REPLACE FUNCTION public.issue_ticket(p_token uuid, p_queue_id uuid, p_priority boolean DEFAULT false, p_lang text DEFAULT 'pt'::text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE dev public.devices; q public.queues; n int; t public.tickets; pos int; wait int; ds timestamptz; strat text;
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

  strat := private.effective_strategy(dev.org_id)->>'strategy';
  SELECT count(*) INTO pos FROM public.tickets w
    WHERE w.queue_id = q.id AND w.status = 'em_espera' AND w.created_at >= ds
      AND (CASE WHEN strat = 'chegada' THEN w.sort_at <= t.sort_at
                ELSE (w.priority > t.priority OR (w.priority = t.priority AND w.sort_at <= t.sort_at)) END);
  wait := GREATEST(pos - 1, 0) * q.avg_duration_minutes;
  RETURN jsonb_build_object('ticket', to_jsonb(t), 'position', pos, 'wait_minutes', wait,
    'server_now', now(), 'strategy', strat,
    'queue', jsonb_build_object('name',q.name,'name_en',q.name_en));
END; $$;

CREATE OR REPLACE FUNCTION public.ticket_status(p_ticket_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE t public.tickets; q public.queues; org public.organizations; pos int; dest text; strat text;
BEGIN
  SELECT * INTO t FROM public.tickets WHERE id = p_ticket_id;
  IF t.id IS NULL THEN RETURN jsonb_build_object('error','not_found'); END IF;
  SELECT * INTO q FROM public.queues WHERE id = t.queue_id;
  SELECT * INTO org FROM public.organizations WHERE id = t.org_id;
  strat := private.effective_strategy(t.org_id)->>'strategy';
  SELECT count(*) INTO pos FROM public.tickets w
    WHERE w.queue_id = t.queue_id AND w.status = 'em_espera' AND w.created_at >= private.org_day_start(t.org_id)
      AND (CASE WHEN strat = 'chegada' THEN w.sort_at <= t.sort_at
                ELSE (w.priority > t.priority OR (w.priority = t.priority AND w.sort_at <= t.sort_at)) END);
  SELECT COALESCE((SELECT name FROM public.desks WHERE id = t.desk_id),(SELECT name FROM public.cabinets WHERE id = t.cabinet_id)) INTO dest;
  RETURN jsonb_build_object(
    'ticket', jsonb_build_object('id',t.id,'full_ticket',t.full_ticket,'status',t.status,'priority',t.priority,'lang_used',t.lang_used,'called_at',t.called_at),
    'queue', jsonb_build_object('name',q.name,'name_en',q.name_en,'avg_duration_minutes',q.avg_duration_minutes),
    'org', jsonb_build_object('name',org.name,'logo_url',org.logo_url,'primary_color',org.primary_color),
    'position', pos, 'destination', dest, 'server_now', now(),
    'wait_minutes', GREATEST(pos-1,0) * q.avg_duration_minutes);
END; $$;

-- ---------- device context: expose the rule in force ----------
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
      'timezone',org.timezone,'reset_time',org.reset_time,
      'queue_strategy',org.queue_strategy,'priority_ratio',org.priority_ratio),
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

-- ---------- TV: next tickets follow the clinic rule ----------
CREATE OR REPLACE FUNCTION public.tv_state(p_token uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE dev public.devices; ds timestamptz; res jsonb; strat text;
BEGIN
  SELECT * INTO dev FROM public.devices WHERE token = p_token AND active = true;
  IF dev.id IS NULL THEN RETURN jsonb_build_object('error','invalid_token'); END IF;
  ds := private.org_day_start(dev.org_id);
  strat := private.effective_strategy(dev.org_id)->>'strategy';

  SELECT jsonb_build_object(
    'server_now', now(),
    'strategy', strat,
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
                    ORDER BY (CASE WHEN strat = 'chegada' THEN false ELSE t.priority END) DESC, t.sort_at ASC
                    LIMIT 2) x), '[]'::jsonb)
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