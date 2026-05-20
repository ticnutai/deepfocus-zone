-- Role-level layout defaults: applied to users with the role who have no personal saved layout yet
CREATE TABLE IF NOT EXISTS public.role_layout_defaults (
  role_id uuid PRIMARY KEY REFERENCES public.app_roles(id) ON DELETE CASCADE,
  widget_layout jsonb,
  sidebar_config jsonb,
  category_template jsonb,
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.role_layout_defaults ENABLE ROW LEVEL SECURITY;

CREATE POLICY "role_layout_defaults_read_authenticated"
  ON public.role_layout_defaults FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "role_layout_defaults_admin_write"
  ON public.role_layout_defaults FOR ALL TO authenticated
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));

CREATE TRIGGER trg_role_layout_defaults_updated_at
  BEFORE UPDATE ON public.role_layout_defaults
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Helper: return the layout defaults for the current user based on their highest-priority role
CREATE OR REPLACE FUNCTION public.get_my_role_layout_defaults()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'widget_layout',     rld.widget_layout,
    'sidebar_config',    rld.sidebar_config,
    'category_template', rld.category_template,
    'role_name',         r.name,
    'updated_at',        rld.updated_at
  )
  FROM public.user_roles ur
  JOIN public.app_roles r ON r.id = ur.role_id
  LEFT JOIN public.role_layout_defaults rld ON rld.role_id = ur.role_id
  WHERE ur.user_id = auth.uid()
    AND rld.widget_layout IS NOT NULL
  ORDER BY CASE WHEN r.name = 'admin' THEN 0 ELSE 1 END, rld.updated_at DESC NULLS LAST
  LIMIT 1;
$$;