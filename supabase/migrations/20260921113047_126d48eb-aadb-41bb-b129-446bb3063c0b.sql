CREATE TABLE public.config_suggestions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  prompt text NOT NULL,
  suggestion jsonb NOT NULL,
  model text,
  status text NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente','aplicada','descartada')),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  applied_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  applied_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX config_suggestions_org_idx ON public.config_suggestions (org_id, created_at DESC);

GRANT SELECT, INSERT, UPDATE ON public.config_suggestions TO authenticated;
GRANT ALL ON public.config_suggestions TO service_role;

ALTER TABLE public.config_suggestions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "suggestions_select" ON public.config_suggestions
  FOR SELECT TO authenticated
  USING (private.is_super_admin()
         OR (org_id = private.current_org_id() AND private.can_manage_org_config()));

CREATE POLICY "suggestions_insert" ON public.config_suggestions
  FOR INSERT TO authenticated
  WITH CHECK (private.is_super_admin()
              OR (org_id = private.current_org_id() AND private.can_manage_org_config()));

CREATE POLICY "suggestions_update" ON public.config_suggestions
  FOR UPDATE TO authenticated
  USING (private.is_super_admin()
         OR (org_id = private.current_org_id() AND private.can_manage_org_config()))
  WITH CHECK (private.is_super_admin()
              OR (org_id = private.current_org_id() AND private.can_manage_org_config()));

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

CREATE TRIGGER config_suggestions_updated_at
BEFORE UPDATE ON public.config_suggestions
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Aplica uma sugestão: cria/atualiza filas, balcões, gabinetes e regras.
CREATE OR REPLACE FUNCTION public.apply_config_suggestion(p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  o uuid := private.current_org_id();
  s public.config_suggestions;
  item jsonb; qid uuid; qids jsonb; ref text;
  strat text; pr int; nr int;
  created_q int := 0; updated_q int := 0; created_d int := 0; created_c int := 0;
  next_order int;
BEGIN
  IF o IS NULL THEN RETURN jsonb_build_object('error','no_access'); END IF;
  IF NOT private.can_manage_org_config() THEN RETURN jsonb_build_object('error','forbidden'); END IF;
  SELECT * INTO s FROM public.config_suggestions WHERE id = p_id AND org_id = o;
  IF s.id IS NULL THEN RETURN jsonb_build_object('error','not_found'); END IF;
  IF s.status = 'aplicada' THEN RETURN jsonb_build_object('error','already_applied'); END IF;

  -- Filas
  SELECT COALESCE(max("order"),0) INTO next_order FROM public.queues WHERE org_id = o;
  FOR item IN SELECT * FROM jsonb_array_elements(COALESCE(s.suggestion->'filas','[]'::jsonb)) LOOP
    IF COALESCE(btrim(item->>'prefix'),'') = '' THEN CONTINUE; END IF;
    SELECT id INTO qid FROM public.queues WHERE org_id = o AND upper(prefix) = upper(btrim(item->>'prefix'));
    IF qid IS NULL THEN
      next_order := next_order + 1;
      INSERT INTO public.queues (org_id, name, name_en, prefix, color, icon, priority_enabled,
                                 active, "order", avg_duration_minutes)
      VALUES (o,
        COALESCE(NULLIF(btrim(item->>'name'),''), btrim(item->>'prefix')),
        NULLIF(btrim(COALESCE(item->>'name_en','')),''),
        upper(btrim(item->>'prefix')),
        COALESCE(NULLIF(btrim(COALESCE(item->>'color','')),''), '#1a6fc4'),
        NULLIF(btrim(COALESCE(item->>'icon','')),''),
        COALESCE((item->>'priority_enabled')::boolean, true),
        true, next_order,
        GREATEST(COALESCE((item->>'avg_duration_minutes')::int, 10), 1));
      created_q := created_q + 1;
    ELSE
      UPDATE public.queues SET
        name = COALESCE(NULLIF(btrim(COALESCE(item->>'name','')),''), name),
        name_en = COALESCE(NULLIF(btrim(COALESCE(item->>'name_en','')),''), name_en),
        color = COALESCE(NULLIF(btrim(COALESCE(item->>'color','')),''), color),
        priority_enabled = COALESCE((item->>'priority_enabled')::boolean, priority_enabled),
        avg_duration_minutes = GREATEST(COALESCE((item->>'avg_duration_minutes')::int, avg_duration_minutes), 1),
        active = true
      WHERE id = qid;
      updated_q := updated_q + 1;
    END IF;
  END LOOP;

  -- Balcões
  FOR item IN SELECT * FROM jsonb_array_elements(COALESCE(s.suggestion->'balcoes','[]'::jsonb)) LOOP
    IF COALESCE(btrim(item->>'name'),'') = '' THEN CONTINUE; END IF;
    qids := '[]'::jsonb;
    FOR ref IN SELECT jsonb_array_elements_text(COALESCE(item->'filas','[]'::jsonb)) LOOP
      SELECT id INTO qid FROM public.queues
       WHERE org_id = o AND (upper(prefix) = upper(btrim(ref)) OR lower(name) = lower(btrim(ref)));
      IF qid IS NOT NULL THEN qids := qids || to_jsonb(qid::text); END IF;
    END LOOP;
    strat := CASE WHEN item->>'strategy' IN ('chegada','prioridade','alternado','duracao')
                  THEN item->>'strategy' END;
    pr := CASE WHEN strat IS NULL THEN NULL ELSE GREATEST(COALESCE((item->>'priority')::int,2),1) END;
    nr := CASE WHEN strat IS NULL THEN NULL ELSE GREATEST(COALESCE((item->>'normal')::int,1),1) END;

    IF EXISTS (SELECT 1 FROM public.desks WHERE org_id = o AND lower(name) = lower(btrim(item->>'name'))) THEN
      UPDATE public.desks SET queue_ids = qids, active = true,
        queue_strategy = strat,
        priority_ratio = CASE WHEN strat IS NULL THEN NULL
                              ELSE jsonb_build_object('priority',pr,'normal',nr) END
      WHERE org_id = o AND lower(name) = lower(btrim(item->>'name'));
    ELSE
      INSERT INTO public.desks (org_id, name, queue_ids, active, queue_strategy, priority_ratio)
      VALUES (o, btrim(item->>'name'), qids, true, strat,
              CASE WHEN strat IS NULL THEN NULL ELSE jsonb_build_object('priority',pr,'normal',nr) END);
      created_d := created_d + 1;
    END IF;
  END LOOP;

  -- Gabinetes
  FOR item IN SELECT * FROM jsonb_array_elements(COALESCE(s.suggestion->'gabinetes','[]'::jsonb)) LOOP
    IF COALESCE(btrim(item->>'name'),'') = '' THEN CONTINUE; END IF;
    qids := '[]'::jsonb;
    FOR ref IN SELECT jsonb_array_elements_text(COALESCE(item->'filas','[]'::jsonb)) LOOP
      SELECT id INTO qid FROM public.queues
       WHERE org_id = o AND (upper(prefix) = upper(btrim(ref)) OR lower(name) = lower(btrim(ref)));
      IF qid IS NOT NULL THEN qids := qids || to_jsonb(qid::text); END IF;
    END LOOP;
    strat := CASE WHEN item->>'strategy' IN ('chegada','prioridade','alternado','duracao')
                  THEN item->>'strategy' END;
    pr := CASE WHEN strat IS NULL THEN NULL ELSE GREATEST(COALESCE((item->>'priority')::int,2),1) END;
    nr := CASE WHEN strat IS NULL THEN NULL ELSE GREATEST(COALESCE((item->>'normal')::int,1),1) END;

    IF EXISTS (SELECT 1 FROM public.cabinets WHERE org_id = o AND lower(name) = lower(btrim(item->>'name'))) THEN
      UPDATE public.cabinets SET queue_ids = qids, active = true,
        queue_strategy = strat,
        priority_ratio = CASE WHEN strat IS NULL THEN NULL
                              ELSE jsonb_build_object('priority',pr,'normal',nr) END
      WHERE org_id = o AND lower(name) = lower(btrim(item->>'name'));
    ELSE
      INSERT INTO public.cabinets (org_id, name, queue_ids, active, queue_strategy, priority_ratio)
      VALUES (o, btrim(item->>'name'), qids, true, strat,
              CASE WHEN strat IS NULL THEN NULL ELSE jsonb_build_object('priority',pr,'normal',nr) END);
      created_c := created_c + 1;
    END IF;
  END LOOP;

  -- Regra da clínica
  strat := CASE WHEN s.suggestion->'clinica'->>'strategy' IN ('chegada','prioridade','alternado','duracao')
                THEN s.suggestion->'clinica'->>'strategy' END;
  IF strat IS NOT NULL THEN
    UPDATE public.organizations SET queue_strategy = strat,
      priority_ratio = jsonb_build_object(
        'priority', GREATEST(COALESCE((s.suggestion->'clinica'->>'priority')::int,2),1),
        'normal', GREATEST(COALESCE((s.suggestion->'clinica'->>'normal')::int,1),1))
    WHERE id = o;
  END IF;

  UPDATE public.config_suggestions
     SET status = 'aplicada', applied_by = auth.uid(), applied_at = now()
   WHERE id = s.id;

  RETURN jsonb_build_object('status','ok','queues_created',created_q,'queues_updated',updated_q,
    'desks_created',created_d,'cabinets_created',created_c,'server_now',now());
END; $$;

REVOKE ALL ON FUNCTION public.apply_config_suggestion(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.apply_config_suggestion(uuid) TO authenticated;