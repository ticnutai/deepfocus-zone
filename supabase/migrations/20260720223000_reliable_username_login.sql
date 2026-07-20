-- Make username login reliable for both existing profiles and new signups.

-- Existing accounts get the local part of their email when it is valid and
-- unique. This assigns jj1212t to jj1212t@gmail.com without overwriting any
-- username an administrator already chose.
WITH candidates AS (
  SELECT
    p.id,
    regexp_replace(lower(split_part(coalesce(p.email, ''), '@', 1)), '[^a-z0-9_.]', '', 'g') AS candidate
  FROM public.profiles p
  WHERE p.username IS NULL OR btrim(p.username) = ''
), unique_candidates AS (
  SELECT candidate
  FROM candidates
  WHERE length(candidate) >= 3
  GROUP BY candidate
  HAVING count(*) = 1
)
UPDATE public.profiles p
SET username = c.candidate
FROM candidates c
JOIN unique_candidates u ON u.candidate = c.candidate
WHERE p.id = c.id
  AND NOT EXISTS (
    SELECT 1
    FROM public.profiles existing
    WHERE existing.id <> p.id
      AND lower(existing.username) = c.candidate
  );

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status text;
  v_username text;
BEGIN
  SELECT CASE
    WHEN EXISTS (
      SELECT 1 FROM public.approved_emails
      WHERE lower(email) = lower(NEW.email)
    ) THEN 'approved'
    ELSE 'pending'
  END INTO v_status;

  v_username := regexp_replace(
    lower(trim(coalesce(
      NEW.raw_user_meta_data->>'username',
      split_part(NEW.email, '@', 1)
    ))),
    '[^a-z0-9_.]',
    '',
    'g'
  );

  IF length(v_username) < 3 OR EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id <> NEW.id AND lower(p.username) = v_username
  ) THEN
    v_username := NULL;
  END IF;

  INSERT INTO public.profiles (id, display_name, email, status, username)
  VALUES (
    NEW.id,
    COALESCE(
      NEW.raw_user_meta_data->>'display_name',
      NEW.raw_user_meta_data->>'full_name',
      NEW.raw_user_meta_data->>'name',
      split_part(NEW.email, '@', 1)
    ),
    lower(NEW.email),
    v_status,
    v_username
  )
  ON CONFLICT (id) DO UPDATE
  SET email = EXCLUDED.email,
      display_name = COALESCE(public.profiles.display_name, EXCLUDED.display_name),
      status = EXCLUDED.status,
      username = COALESCE(public.profiles.username, EXCLUDED.username);

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
