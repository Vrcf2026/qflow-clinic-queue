-- Garantir que o seed de demonstração existe e está correcto
-- (corre em modo idempotente — pode ser re-executado sem erros)

DO $$
DECLARE
  v_org_id uuid;
BEGIN
  -- Criar ou reutilizar org demo
  INSERT INTO public.organizations (
    id, name, slug, plan,
    primary_color, secondary_color,
    voice_lang, timezone, reset_time,
    kiosk_languages,
    modules_enabled,
    tv_config
  ) VALUES (
    '00000000-0000-0000-0000-000000000001',
    'Clínica Demo QFlow',
    'demo',
    'pro',
    '#1a6fc4', '#07101f',
    'pt', 'Europe/Lisbon', '08:00',
    '{"pt": true, "en": true}'::jsonb,
    '{"kiosk":true,"tv":true,"recepcao":true,"gabinetes":true,"iptv":false,"sms":false,"prioritarios":true,"multi_balcao":true}'::jsonb,
    '{"layout":"video_esquerda","video_ratio":65,"volume":0.5,"silenciar_em_chamada":true,"stream_url":"","m3u_url":"","active_channel":""}'::jsonb
  )
  ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name,
    modules_enabled = EXCLUDED.modules_enabled;

  v_org_id := '00000000-0000-0000-0000-000000000001';

  -- Filas demo
  INSERT INTO public.queues (org_id, name, name_en, prefix, color, priority_enabled, active, "order", avg_duration_minutes)
  VALUES
    (v_org_id, 'Consulta',    'Consultation', 'C', '#1a6fc4', true,  true, 1, 15),
    (v_org_id, 'Exames',      'Tests',        'E', '#1a9e6e', false, true, 2, 10),
    (v_org_id, 'Pagamento',   'Payment',      'P', '#b87800', false, true, 3, 5),
    (v_org_id, 'Receituário', 'Prescriptions','R', '#7c3aed', false, true, 4, 8)
  ON CONFLICT DO NOTHING;

  -- Balcões demo
  INSERT INTO public.desks (org_id, name, active)
  VALUES
    (v_org_id, 'Balcão 1', true),
    (v_org_id, 'Balcão 2', true)
  ON CONFLICT DO NOTHING;

  -- Gabinetes demo
  INSERT INTO public.cabinets (org_id, name, active)
  VALUES
    (v_org_id, 'Gabinete 1', true),
    (v_org_id, 'Gabinete 2', true)
  ON CONFLICT DO NOTHING;

  -- Dispositivos demo (tokens fixos para URLs de demonstração)
  INSERT INTO public.devices (org_id, name, type, token, active)
  VALUES
    (v_org_id, 'Quiosque Demo', 'quiosque', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', true),
    (v_org_id, 'TV Sala Espera Demo', 'tv', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', true)
  ON CONFLICT (token) DO UPDATE SET
    name = EXCLUDED.name,
    active = true;

END $$;
