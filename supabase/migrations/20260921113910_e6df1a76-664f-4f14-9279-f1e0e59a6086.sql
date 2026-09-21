-- audit: suggestion generated / discarded
CREATE OR REPLACE FUNCTION private.audit_suggestion()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE lbl text;
BEGIN
  lbl := left(COALESCE(NEW.prompt,''), 80);
  IF TG_OP = 'INSERT' THEN
    PERFORM private.audit_write(NEW.org_id, 'sugestao_ia', NEW.id, lbl, 'sugestao_gerada',
      jsonb_build_object(
        'prompt', NEW.prompt,
        'model', NEW.model,
        'resumo', NEW.suggestion->>'resumo',
        'propostas', jsonb_build_object(
          'filas', jsonb_array_length(COALESCE(NEW.suggestion->'filas','[]'::jsonb)),
          'balcoes', jsonb_array_length(COALESCE(NEW.suggestion->'balcoes','[]'::jsonb)),
          'gabinetes', jsonb_array_length(COALESCE(NEW.suggestion->'gabinetes','[]'::jsonb))),
        'sugestao', NEW.suggestion),
      NEW.created_by);
    RETURN NEW;
  END IF;

  IF NEW.status = 'descartada' AND OLD.status <> 'descartada' THEN
    PERFORM private.audit_write(NEW.org_id, 'sugestao_ia', NEW.id, lbl, 'sugestao_descartada',
      jsonb_build_object('prompt', NEW.prompt, 'rejeitado', 'sugestao_completa',
                         'sugestao', NEW.suggestion));
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS audit_config_suggestions_ins ON public.config_suggestions;
CREATE TRIGGER audit_config_suggestions_ins AFTER INSERT ON public.config_suggestions
FOR EACH ROW EXECUTE FUNCTION private.audit_suggestion();

DROP TRIGGER IF EXISTS audit_config_suggestions_upd ON public.config_suggestions;
CREATE TRIGGER audit_config_suggestions_upd AFTER UPDATE ON public.config_suggestions
FOR EACH ROW EXECUTE FUNCTION private.audit_suggestion();

-- apply: record accepted and rejected parts
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
  acc_q jsonb := '[]'::jsonb; acc_d jsonb := '[]'::jsonb; acc_c jsonb := '[]'::jsonb;
  rej jsonb := '[]'::jsonb; clinic_applied jsonb := 'null'::jsonb;
BEGIN
  IF o IS NULL THEN RETURN jsonb_build_object('error','no_access'); END IF;
  IF NOT private.can_manage_org_config() THEN RETURN jsonb_build_object('error','forbidden'); END IF;
  SELECT * INTO s FROM public.config_suggestions WHERE id = p_id AND org_id = o;
  IF s.id IS NULL THEN RETURN jsonb_build_object('error','not_found'); END IF;
  IF s.status = 'aplicada' THEN RETURN jsonb_build_object('error','already_applied'); END IF;

  SELECT COALESCE(max("order"),0) INTO next_order FROM public.queues WHERE org_id = o;
  FOR item IN SELECT * FROM jsonb_array_elements(COALESCE(s.suggestion->'filas','[]'::jsonb)) LOOP
    IF COALESCE(btrim(item->>'prefix'),'') = '' THEN
      rej := rej || jsonb_build_object('tipo','fila','item',item,'motivo','sem_prefixo');
      CONTINUE;
    END IF;
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
        COALESCE(NULLIF(btrim(COALESCE(item->>'icon','')),''), 'circle'),
        COALESCE((item->>'priority_enabled')::boolean, true),
        true, next_order,
        GREATEST(COALESCE((item->>'avg_duration_minutes')::int, 10), 1));
      created_q := created_q + 1;
      acc_q := acc_q || jsonb_build_object('prefix', upper(btrim(item->>'prefix')),
                 'name', item->>'name', 'acao','criada');
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
      acc_q := acc_q || jsonb_build_object('prefix', upper(btrim(item->>'prefix')),
                 'name', item->>'name', 'acao','atualizada');
    END IF;
  END LOOP;

  FOR item IN SELECT * FROM jsonb_array_elements(COALESCE(s.suggestion->'balcoes','[]'::jsonb)) LOOP
    IF COALESCE(btrim(item->>'name'),'') = '' THEN
      rej := rej || jsonb_build_object('tipo','balcao','item',item,'motivo','sem_nome');
      CONTINUE;
    END IF;
    qids := '[]'::jsonb;
    FOR ref IN SELECT jsonb_array_elements_text(COALESCE(item->'filas','[]'::jsonb)) LOOP
      SELECT id INTO qid FROM public.queues
       WHERE org_id = o AND (upper(prefix) = upper(btrim(ref)) OR lower(name) = lower(btrim(ref)));
      IF qid IS NOT NULL THEN qids := qids || to_jsonb(qid::text);
      ELSE rej := rej || jsonb_build_object('tipo','fila_de_balcao','item',
             jsonb_build_object('balcao', item->>'name','fila',ref),'motivo','fila_inexistente');
      END IF;
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
      acc_d := acc_d || jsonb_build_object('name', item->>'name','acao','atualizado',
                 'strategy', strat, 'filas', COALESCE(item->'filas','[]'::jsonb));
    ELSE
      INSERT INTO public.desks (org_id, name, queue_ids, active, queue_strategy, priority_ratio)
      VALUES (o, btrim(item->>'name'), qids, true, strat,
              CASE WHEN strat IS NULL THEN NULL ELSE jsonb_build_object('priority',pr,'normal',nr) END);
      created_d := created_d + 1;
      acc_d := acc_d || jsonb_build_object('name', item->>'name','acao','criado',
                 'strategy', strat, 'filas', COALESCE(item->'filas','[]'::jsonb));
    END IF;
  END LOOP;

  FOR item IN SELECT * FROM jsonb_array_elements(COALESCE(s.suggestion->'gabinetes','[]'::jsonb)) LOOP
    IF COALESCE(btrim(item->>'name'),'') = '' THEN
      rej := rej || jsonb_build_object('tipo','gabinete','item',item,'motivo','sem_nome');
      CONTINUE;
    END IF;
    qids := '[]'::jsonb;
    FOR ref IN SELECT jsonb_array_elements_text(COALESCE(item->'filas','[]'::jsonb)) LOOP
      SELECT id INTO qid FROM public.queues
       WHERE org_id = o AND (upper(prefix) = upper(btrim(ref)) OR lower(name) = lower(btrim(ref)));
      IF qid IS NOT NULL THEN qids := qids || to_jsonb(qid::text);
      ELSE rej := rej || jsonb_build_object('tipo','fila_de_gabinete','item',
             jsonb_build_object('gabinete', item->>'name','fila',ref),'motivo','fila_inexistente');
      END IF;
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
      acc_c := acc_c || jsonb_build_object('name', item->>'name','acao','atualizado',
                 'strategy', strat, 'filas', COALESCE(item->'filas','[]'::jsonb));
    ELSE
      INSERT INTO public.cabinets (org_id, name, queue_ids, active, queue_strategy, priority_ratio)
      VALUES (o, btrim(item->>'name'), qids, true, strat,
              CASE WHEN strat IS NULL THEN NULL ELSE jsonb_build_object('priority',pr,'normal',nr) END);
      created_c := created_c + 1;
      acc_c := acc_c || jsonb_build_object('name', item->>'name','acao','criado',
                 'strategy', strat, 'filas', COALESCE(item->'filas','[]'::jsonb));
    END IF;
  END LOOP;

  strat := CASE WHEN s.suggestion->'clinica'->>'strategy' IN ('chegada','prioridade','alternado','duracao')
                THEN s.suggestion->'clinica'->>'strategy' END;
  IF strat IS NOT NULL THEN
    pr := GREATEST(COALESCE((s.suggestion->'clinica'->>'priority')::int,2),1);
    nr := GREATEST(COALESCE((s.suggestion->'clinica'->>'normal')::int,1),1);
    UPDATE public.organizations SET queue_strategy = strat,
      priority_ratio = jsonb_build_object('priority', pr, 'normal', nr)
    WHERE id = o;
    clinic_applied := jsonb_build_object('strategy',strat,'priority',pr,'normal',nr);
  ELSIF s.suggestion ? 'clinica' THEN
    rej := rej || jsonb_build_object('tipo','regra_clinica','item', s.suggestion->'clinica',
             'motivo','estrategia_invalida');
  END IF;

  UPDATE public.config_suggestions
     SET status = 'aplicada', applied_by = auth.uid(), applied_at = now()
   WHERE id = s.id;

  PERFORM private.audit_write(o, 'sugestao_ia', s.id, left(COALESCE(s.prompt,''),80),
    'sugestao_aplicada',
    jsonb_build_object(
      'prompt', s.prompt,
      'model', s.model,
      'aceites', jsonb_build_object('filas', acc_q, 'balcoes', acc_d, 'gabinetes', acc_c,
                                    'regra_clinica', clinic_applied),
      'rejeitados', rej,
      'totais', jsonb_build_object('filas_criadas',created_q,'filas_atualizadas',updated_q,
                                   'balcoes_criados',created_d,'gabinetes_criados',created_c,
                                   'rejeitados', jsonb_array_length(rej))));

  RETURN jsonb_build_object('status','ok','queues_created',created_q,'queues_updated',updated_q,
    'desks_created',created_d,'cabinets_created',created_c,
    'rejected', jsonb_array_length(rej), 'server_now',now());
END; $$;

REVOKE ALL ON FUNCTION public.apply_config_suggestion(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.apply_config_suggestion(uuid) TO authenticated;