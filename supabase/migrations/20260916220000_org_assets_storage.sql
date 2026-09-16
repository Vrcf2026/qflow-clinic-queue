-- Bucket público para logos e assets das clínicas
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'org-assets',
  'org-assets',
  true,
  2097152, -- 2 MB
  ARRAY['image/png','image/jpeg','image/webp','image/svg+xml','image/gif']
)
ON CONFLICT (id) DO NOTHING;

-- Super admin pode fazer upload
CREATE POLICY "super_admin_upload" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'org-assets'
    AND EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_id = auth.uid() AND role = 'super_admin'
    )
  );

-- Org admin pode fazer upload para a sua clínica
CREATE POLICY "org_admin_upload" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'org-assets'
    AND EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_id = auth.uid() AND role IN ('org_admin', 'super_admin')
    )
  );

-- Leitura pública (logos são públicos por natureza)
CREATE POLICY "public_read" ON storage.objects
  FOR SELECT TO anon, authenticated
  USING (bucket_id = 'org-assets');

-- Podem apagar o que fizeram upload
CREATE POLICY "owner_delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'org-assets'
    AND EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_id = auth.uid() AND role IN ('org_admin', 'super_admin')
    )
  );
