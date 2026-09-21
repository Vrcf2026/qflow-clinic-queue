CREATE OR REPLACE FUNCTION public.preview_config_suggestion(p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row       config_suggestions;
  v_org       uuid;
  v_s         jsonb;
  v_atual     jsonb;
  v_diff_q    jsonb := '[]'::jsonb;
  v_diff_d    jsonb := '[]'::jsonb;
  v_diff_c    jsonb := '[]'::jsonb;
  v_diff_org  jsonb;
  v_val       jsonb := '[]'::jsonb;
  v_item      jsonb;
  v_prefix    text;
  v_name      text;
  v_campos    jsonb;
  v_estado    text;
  v_q         record;
  v_p         record;
  v_seen      text[] := '{}';
  v_known     text[] := '{}';
  v_tok       text;
  v_missing   text[];
  v_strategy  text;
  v_pri       int;
  v_nor       int;
  v_filas_pref text[];
BEGIN
  IF NOT private.can_manage_org_config() THEN
    RETURN jsonb_build_object('error', 'forbidden');
  END IF;

  SELECT * INTO v_row FROM config_suggestions WHERE id = p_id;
  IF v_row.id IS NULL THEN
    RETURN jsonb_build_object('error', 'not_found');
  END IF;
  IF NOT private.is_super_admin() AND v_row.org_id <> private.current_org_id() THEN
    RETURN jsonb_build_object('error', 'forbidden');
  END IF;

  v_org := v_row.org_id;
  v_s := coalesce(v_row.suggestion, '{}'::jsonb);

  -- configuração atual
  SELECT jsonb_build_object(
    'clinica', (
      SELECT jsonb_build_object(
        'strategy', o.queue_strategy,
        'priority', coalesce((o.priority_ratio->>'priority')::int, 2),
        'normal', coalesce((o.priority_ratio->>'normal')::int, 1)
      ) FROM organizations o WHERE o.id = v_org
    ),
    'filas', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'prefix', q.prefix, 'name', q.name, 'color', q.color,
        'priority_enabled', q.priority_enabled,
        'avg_duration_minutes', q.avg_duration_minutes,
        'active', q.active
      ) ORDER BY q."order", q.name)
      FROM queues q WHERE q.org_id = v_org
    ), '[]'::jsonb),
    'balcoes', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'name', d.name, 'strategy', d.queue_strategy,
        'priority', (d.priority_ratio->>'priority')::int,
        'normal', (d.priority_ratio->>'normal')::int,
        'filas', coalesce((
          SELECT jsonb_agg(q2.prefix ORDER BY idx.ord)
          FROM jsonb_array_elements_text(d.queue_ids) WITH ORDINALITY AS idx(qid, ord)
          JOIN queues q2 ON q2.id = idx.qid::uuid
        ), '[]'::jsonb)
      ) ORDER BY d.name)
      FROM desks d WHERE d.org_id = v_org
    ), '[]'::jsonb),
    'gabinetes', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'name', c.name, 'strategy', c.queue_strategy,
        'priority', (c.priority_ratio->>'priority')::int,
        'normal', (c.priority_ratio->>'normal')::int,
        'filas', coalesce((
          SELECT jsonb_agg(q2.prefix ORDER BY idx.ord)
          FROM jsonb_array_elements_text(c.queue_ids) WITH ORDINALITY AS idx(qid, ord)
          JOIN queues q2 ON q2.id = idx.qid::uuid
        ), '[]'::jsonb)
      ) ORDER BY c.name)
      FROM cabinets c WHERE c.org_id = v_org
    ), '[]'::jsonb)
  ) INTO v_atual;

  -- tokens de fila reconhecíveis (sugeridos + existentes), em maiúsculas
  SELECT array_agg(DISTINCT upper(t)) INTO v_known FROM (
    SELECT jsonb_array_elements(coalesce(v_s->'filas', '[]'::jsonb))->>'prefix' AS t
    UNION ALL
    SELECT jsonb_array_elements(coalesce(v_s->'filas', '[]'::jsonb))->>'name'
    UNION ALL
    SELECT q.prefix FROM queues q WHERE q.org_id = v_org
    UNION ALL
    SELECT q.name FROM queues q WHERE q.org_id = v_org
  ) s WHERE t IS NOT NULL AND btrim(t) <> '';

  -- diff das filas
  FOR v_item IN SELECT * FROM jsonb_array_elements(coalesce(v_s->'filas', '[]'::jsonb)) LOOP
    v_prefix := upper(btrim(coalesce(v_item->>'prefix', '')));
    IF v_prefix = '' THEN
      v_val := v_val || jsonb_build_object('nivel', 'erro', 'mensagem',
        format('A fila "%s" não tem prefixo de senha.', coalesce(v_item->>'name', 'sem nome')));
      CONTINUE;
    END IF;
    IF v_prefix = ANY (v_seen) THEN
      v_val := v_val || jsonb_build_object('nivel', 'erro', 'mensagem',
        format('O prefixo "%s" aparece mais do que uma vez na sugestão.', v_prefix));
      CONTINUE;
    END IF;
    v_seen := v_seen || v_prefix;

    SELECT * INTO v_q FROM queues q WHERE q.org_id = v_org AND upper(q.prefix) = v_prefix LIMIT 1;
    v_campos := '[]'::jsonb;
    IF v_q.id IS NULL THEN
      v_estado := 'nova';
    ELSE
      IF coalesce(btrim(v_item->>'name'), '') <> '' AND v_item->>'name' <> v_q.name THEN
        v_campos := v_campos || jsonb_build_object('campo', 'Nome', 'antes', v_q.name, 'depois', v_item->>'name');
      END IF;
      IF coalesce(v_item->>'color', '') <> '' AND v_item->>'color' <> v_q.color THEN
        v_campos := v_campos || jsonb_build_object('campo', 'Cor', 'antes', v_q.color, 'depois', v_item->>'color');
      END IF;
      IF (v_item->>'avg_duration_minutes') IS NOT NULL
         AND (v_item->>'avg_duration_minutes')::int <> v_q.avg_duration_minutes THEN
        v_campos := v_campos || jsonb_build_object('campo', 'Duração média (min)',
          'antes', v_q.avg_duration_minutes::text, 'depois', v_item->>'avg_duration_minutes');
      END IF;
      IF (v_item->>'priority_enabled') IS NOT NULL
         AND (v_item->>'priority_enabled')::boolean <> v_q.priority_enabled THEN
        v_campos := v_campos || jsonb_build_object('campo', 'Aceita prioritários',
          'antes', CASE WHEN v_q.priority_enabled THEN 'sim' ELSE 'não' END,
          'depois', CASE WHEN (v_item->>'priority_enabled')::boolean THEN 'sim' ELSE 'não' END);
      END IF;
      v_estado := CASE WHEN jsonb_array_length(v_campos) > 0 THEN 'alterada' ELSE 'igual' END;
    END IF;

    IF (v_item->>'avg_duration_minutes') IS NOT NULL
       AND ((v_item->>'avg_duration_minutes')::int < 3 OR (v_item->>'avg_duration_minutes')::int > 60) THEN
      v_val := v_val || jsonb_build_object('nivel', 'aviso', 'mensagem',
        format('A duração média proposta para "%s" (%s min) é invulgar.', v_prefix, v_item->>'avg_duration_minutes'));
    END IF;

    v_diff_q := v_diff_q || jsonb_build_object(
      'prefix', v_prefix, 'name', coalesce(v_item->>'name', v_prefix),
      'estado', v_estado, 'campos', v_campos,
      'color', coalesce(nullif(v_item->>'color', ''), v_q.color, '#1a6fc4'),
      'avg_duration_minutes', coalesce((v_item->>'avg_duration_minutes')::int, v_q.avg_duration_minutes, 10),
      'priority_enabled', coalesce((v_item->>'priority_enabled')::boolean, v_q.priority_enabled, true),
      'motivo', coalesce(v_item->>'motivo', '')
    );
  END LOOP;

  -- filas atuais que a sugestão não menciona
  SELECT array_agg(q.prefix ORDER BY q.prefix) INTO v_missing
  FROM queues q WHERE q.org_id = v_org AND q.active AND NOT (upper(q.prefix) = ANY (coalesce(v_seen, '{}')));
  IF v_missing IS NOT NULL THEN
    v_val := v_val || jsonb_build_object('nivel', 'aviso', 'mensagem',
      format('As filas %s não são mencionadas e ficam como estão.', array_to_string(v_missing, ', ')));
  END IF;

  -- diff dos postos (balcões e gabinetes)
  FOR v_p IN
    SELECT 'balcao'::text AS tipo, value AS item FROM jsonb_array_elements(coalesce(v_s->'balcoes', '[]'::jsonb))
    UNION ALL
    SELECT 'gabinete'::text, value FROM jsonb_array_elements(coalesce(v_s->'gabinetes', '[]'::jsonb))
  LOOP
    v_item := v_p.item;
    v_name := btrim(coalesce(v_item->>'name', ''));
    IF v_name = '' THEN
      v_val := v_val || jsonb_build_object('nivel', 'erro', 'mensagem',
        format('Há um %s sem nome na sugestão.', v_p.tipo));
      CONTINUE;
    END IF;

    v_strategy := nullif(btrim(coalesce(v_item->>'strategy', '')), '');
    IF v_strategy IS NOT NULL AND v_strategy NOT IN ('chegada', 'prioridade', 'alternado', 'duracao') THEN
      v_val := v_val || jsonb_build_object('nivel', 'erro', 'mensagem',
        format('A regra "%s" proposta para %s não existe.', v_strategy, v_name));
    END IF;
    v_pri := (v_item->>'priority')::int;
    v_nor := (v_item->>'normal')::int;
    IF v_strategy = 'alternado' AND (coalesce(v_pri, 0) < 1 OR coalesce(v_nor, 0) < 1) THEN
      v_val := v_val || jsonb_build_object('nivel', 'erro', 'mensagem',
        format('O rácio alternado de %s tem de ter pelo menos 1 prioritário e 1 normal.', v_name));
    END IF;

    v_filas_pref := '{}';
    FOR v_tok IN SELECT jsonb_array_elements_text(coalesce(v_item->'filas', '[]'::jsonb)) LOOP
      IF upper(btrim(v_tok)) = ANY (coalesce(v_known, '{}')) THEN
        v_filas_pref := v_filas_pref || upper(btrim(v_tok));
      ELSE
        v_val := v_val || jsonb_build_object('nivel', 'erro', 'mensagem',
          format('%s refere a fila "%s", que não existe nem é criada.', v_name, v_tok));
      END IF;
    END LOOP;
    IF array_length(v_filas_pref, 1) IS NULL THEN
      v_val := v_val || jsonb_build_object('nivel', 'aviso', 'mensagem',
        format('%s fica sem filas atribuídas e não poderá chamar senhas.', v_name));
    END IF;

    IF v_p.tipo = 'balcao' THEN
      SELECT * INTO v_q FROM desks d WHERE d.org_id = v_org AND lower(d.name) = lower(v_name) LIMIT 1;
    ELSE
      SELECT * INTO v_q FROM cabinets c WHERE c.org_id = v_org AND lower(c.name) = lower(v_name) LIMIT 1;
    END IF;

    v_diff_org := jsonb_build_object(
      'name', v_name, 'tipo', v_p.tipo,
      'estado', CASE WHEN v_q.id IS NULL THEN 'novo' ELSE 'alterado' END,
      'filas', to_jsonb(v_filas_pref),
      'strategy', v_strategy,
      'priority', v_pri, 'normal', v_nor,
      'motivo', coalesce(v_item->>'motivo', ''),
      'antes', CASE WHEN v_q.id IS NULL THEN NULL ELSE jsonb_build_object(
        'strategy', v_q.queue_strategy,
        'priority', (v_q.priority_ratio->>'priority')::int,
        'normal', (v_q.priority_ratio->>'normal')::int,
        'filas', coalesce((
          SELECT jsonb_agg(q2.prefix ORDER BY idx.ord)
          FROM jsonb_array_elements_text(v_q.queue_ids) WITH ORDINALITY AS idx(qid, ord)
          JOIN queues q2 ON q2.id = idx.qid::uuid
        ), '[]'::jsonb)
      ) END
    );
    IF v_p.tipo = 'balcao' THEN
      v_diff_d := v_diff_d || v_diff_org;
    ELSE
      v_diff_c := v_diff_c || v_diff_org;
    END IF;
  END LOOP;

  -- regra da clínica
  v_strategy := nullif(btrim(coalesce(v_s->'clinica'->>'strategy', '')), '');
  v_pri := coalesce((v_s->'clinica'->>'priority')::int, 2);
  v_nor := coalesce((v_s->'clinica'->>'normal')::int, 1);
  IF v_strategy IS NOT NULL AND v_strategy NOT IN ('chegada', 'prioridade', 'alternado', 'duracao') THEN
    v_val := v_val || jsonb_build_object('nivel', 'erro', 'mensagem',
      format('A regra "%s" proposta para a clínica não existe.', v_strategy));
    v_strategy := NULL;
  END IF;
  IF v_strategy = 'alternado' AND (v_pri < 1 OR v_nor < 1) THEN
    v_val := v_val || jsonb_build_object('nivel', 'erro', 'mensagem',
      'O rácio alternado da clínica tem de ter pelo menos 1 prioritário e 1 normal.');
  END IF;

  v_diff_org := jsonb_build_object(
    'antes', v_atual->'clinica',
    'depois', CASE WHEN v_strategy IS NULL THEN NULL
      ELSE jsonb_build_object('strategy', v_strategy, 'priority', v_pri, 'normal', v_nor) END,
    'motivo', coalesce(v_s->'clinica'->>'motivo', '')
  );

  RETURN jsonb_build_object(
    'id', v_row.id,
    'status', v_row.status,
    'prompt', v_row.prompt,
    'atual', v_atual,
    'diff', jsonb_build_object('filas', v_diff_q, 'balcoes', v_diff_d, 'gabinetes', v_diff_c, 'clinica', v_diff_org),
    'validacoes', v_val,
    'erros', (SELECT count(*) FROM jsonb_array_elements(v_val) e WHERE e->>'nivel' = 'erro'),
    'server_now', now()
  );
END;
$$;

REVOKE ALL ON FUNCTION public.preview_config_suggestion(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.preview_config_suggestion(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.preview_config_suggestion(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.preview_config_suggestion(uuid) TO service_role;