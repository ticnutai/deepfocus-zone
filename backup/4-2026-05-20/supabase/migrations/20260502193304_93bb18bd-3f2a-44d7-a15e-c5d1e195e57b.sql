-- Update admin password
UPDATE auth.users
SET encrypted_password = crypt('543211', gen_salt('bf')),
    updated_at = now()
WHERE email = 'jj1212t@gmail.com';

-- Ensure admin role is assigned
INSERT INTO public.user_roles (user_id, role_id)
SELECT u.id, r.id
FROM auth.users u, public.app_roles r
WHERE u.email = 'jj1212t@gmail.com' AND r.name = 'admin'
ON CONFLICT DO NOTHING;