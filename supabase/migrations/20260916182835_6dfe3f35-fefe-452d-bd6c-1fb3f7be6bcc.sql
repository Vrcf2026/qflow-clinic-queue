CREATE OR REPLACE FUNCTION public.bootstrap_access()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE uid uuid := auth.uid(); target_org uuid; existing text;
BEGIN
  IF uid IS NULL THEN RETURN jsonb_build_object('error','not_authenticated'); END IF;

  SELECT role::text INTO existing FROM public.user_roles WHERE user_id = uid LIMIT 1;
  IF existing IS NOT NULL THEN RETURN jsonb_build_object('role', existing); END IF;

  -- primeira org sem qualquer org_admin
  SELECT o.id INTO target_org
  FROM public.organizations o
  WHERE NOT EXISTS (
    SELECT 1 FROM public.user_roles r WHERE r.org_id = o.id AND r.role = 'org_admin'
  )
  ORDER BY o.created_at
  LIMIT 1;

  IF target_org IS NULL THEN RETURN jsonb_build_object('error','no_org_available'); END IF;

  INSERT INTO public.user_roles (user_id, org_id, role) VALUES (uid, target_org, 'org_admin');
  UPDATE public.profiles SET org_id = target_org WHERE id = uid;

  RETURN jsonb_build_object('role','org_admin','org_id',target_org);
END; $$;

REVOKE ALL ON FUNCTION public.bootstrap_access() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.bootstrap_access() TO authenticated;