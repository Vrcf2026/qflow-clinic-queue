-- Tabela de media para o painel TV
-- Suporta: streams HLS/M3U, vídeos MP4 (upload ou URL), e playlists

CREATE TABLE public.tv_media (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name        text NOT NULL,
  type        text NOT NULL CHECK (type IN ('stream', 'm3u', 'video_url', 'video_upload')),
  url         text NOT NULL,          -- URL do stream, M3U, vídeo externo ou storage path
  duration_s  int,                    -- duração em segundos (para vídeos em playlist)
  active      bool NOT NULL DEFAULT true,
  sort_order  int NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX tv_media_org ON public.tv_media (org_id, sort_order);
ALTER TABLE public.tv_media ENABLE ROW LEVEL SECURITY;

CREATE POLICY tm_select ON public.tv_media
  FOR SELECT TO authenticated
  USING (org_id = private.current_org_id() OR private.is_super_admin());

CREATE POLICY tm_anon ON public.tv_media
  FOR SELECT TO anon USING (true);

CREATE POLICY tm_manage ON public.tv_media
  FOR ALL TO authenticated
  USING (private.can_manage_org_config() AND (org_id = private.current_org_id() OR private.is_super_admin()))
  WITH CHECK (private.can_manage_org_config() AND (org_id = private.current_org_id() OR private.is_super_admin()));

-- Bucket para upload de vídeos MP4 (já existe org-assets para logos,
-- criamos um bucket separado com limite maior)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'tv-media',
  'tv-media',
  true,
  524288000,  -- 500 MB por ficheiro
  ARRAY['video/mp4','video/webm','video/ogg','video/quicktime']
)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "tv_media_upload" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'tv-media'
    AND EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_id = auth.uid()
      AND role IN ('org_admin', 'super_admin', 'chefe_turno')
    )
  );

CREATE POLICY "tv_media_read" ON storage.objects
  FOR SELECT TO anon, authenticated
  USING (bucket_id = 'tv-media');

CREATE POLICY "tv_media_delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'tv-media'
    AND EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_id = auth.uid()
      AND role IN ('org_admin', 'super_admin', 'chefe_turno')
    )
  );
