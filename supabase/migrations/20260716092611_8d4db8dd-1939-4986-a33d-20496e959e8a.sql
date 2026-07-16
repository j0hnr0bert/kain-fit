
REVOKE EXECUTE ON FUNCTION public.is_allowed_event_name(text) FROM PUBLIC, anon, authenticated;

INSERT INTO public.user_roles (user_id, role)
SELECT id, 'admin'::public.app_role FROM auth.users WHERE email = 'bravodinero1@gmail.com'
ON CONFLICT (user_id, role) DO NOTHING;

INSERT INTO public.user_roles (user_id, role)
SELECT id, 'founder'::public.app_role FROM auth.users WHERE email = 'bravodinero1@gmail.com'
ON CONFLICT (user_id, role) DO NOTHING;
