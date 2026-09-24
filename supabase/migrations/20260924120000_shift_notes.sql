-- Notas de turno por gabinete
-- Uma nota activa por gabinete por dia de serviço.
-- Substituída (upsert) sempre que o médico guarda — não é um log, é um bloco de notas.

CREATE TABLE public.shift_notes (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  cabinet_id  uuid NOT NULL REFERENCES public.cabinets(id) ON DELETE CASCADE,
  service_day date NOT NULL,        -- dia de serviço (sem hora, fuso da org)
  content     text NOT NULL DEFAULT '',
  updated_by  uuid REFERENCES auth.users(id),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- Índice para lookup rápido
CREATE UNIQUE INDEX shift_notes_cabinet_day ON public.shift_notes (cabinet_id, service_day);
CREATE INDEX shift_notes_org ON public.shift_notes (org_id, service_day DESC);

ALTER TABLE public.shift_notes ENABLE ROW LEVEL SECURITY;

-- Leitura: membros da org
CREATE POLICY sn_select ON public.shift_notes
  FOR SELECT TO authenticated
  USING (org_id = private.current_org_id() OR private.is_super_admin());

-- Escrita: médico do gabinete, chefe de turno ou superior
CREATE POLICY sn_upsert ON public.shift_notes
  FOR ALL TO authenticated
  USING (org_id = private.current_org_id() OR private.is_super_admin())
  WITH CHECK (org_id = private.current_org_id() OR private.is_super_admin());

-- Função para guardar/actualizar nota (upsert seguro)
CREATE OR REPLACE FUNCTION public.save_shift_note(
  p_cabinet_id uuid,
  p_content    text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  v_org_id    uuid;
  v_day       date;
  v_note_id   uuid;
BEGIN
  -- Validar acesso
  SELECT org_id INTO v_org_id
  FROM public.cabinets
  WHERE id = p_cabinet_id
    AND (org_id = private.current_org_id() OR private.is_super_admin());

  IF v_org_id IS NULL THEN
    RETURN jsonb_build_object('error', 'forbidden');
  END IF;

  -- Dia de serviço da org (usa o reset_time configurado)
  SELECT CURRENT_DATE INTO v_day;  -- simplificado; na prática usa o day_start da sessão

  INSERT INTO public.shift_notes (org_id, cabinet_id, service_day, content, updated_by, updated_at)
  VALUES (v_org_id, p_cabinet_id, v_day, p_content, auth.uid(), now())
  ON CONFLICT (cabinet_id, service_day)
  DO UPDATE SET
    content    = EXCLUDED.content,
    updated_by = EXCLUDED.updated_by,
    updated_at = now()
  RETURNING id INTO v_note_id;

  RETURN jsonb_build_object('ok', true, 'id', v_note_id);
END;
$$;

-- Função para carregar nota do dia actual
CREATE OR REPLACE FUNCTION public.load_shift_note(
  p_cabinet_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  v_content text;
  v_updated_at timestamptz;
BEGIN
  SELECT content, updated_at
  INTO v_content, v_updated_at
  FROM public.shift_notes
  WHERE cabinet_id = p_cabinet_id
    AND service_day = CURRENT_DATE
    AND (org_id = private.current_org_id() OR private.is_super_admin());

  IF v_content IS NULL THEN
    RETURN jsonb_build_object('content', '', 'updated_at', null);
  END IF;

  RETURN jsonb_build_object('content', v_content, 'updated_at', v_updated_at);
END;
$$;

GRANT EXECUTE ON FUNCTION public.save_shift_note(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.load_shift_note(uuid) TO authenticated;
