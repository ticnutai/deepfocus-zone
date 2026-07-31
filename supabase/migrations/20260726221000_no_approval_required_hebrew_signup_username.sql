-- Two changes to self-service signup (Google, and email/username+password):
--
-- 1) New accounts no longer default to "pending" admin approval — they start
--    "approved" and can use the app immediately. Admins can still move a user
--    to "pending"/"blocked" manually afterward from the Users admin panel;
--    only the automatic default changes.
--
-- 2) Stop stripping non-ASCII (e.g. Hebrew) characters out of the username
--    captured at signup — it was silently dropping Hebrew usernames to NULL,
--    same issue already fixed for admin-created accounts. The synthetic
--    login email (which must be ASCII) is already resolved client-side
--    before signup, so the trigger only needs to keep the readable username.

-- Also approve everyone already stuck in "pending" right now.
UPDATE public.profiles SET status = 'approved' WHERE status = 'pending';

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status text := 'approved';
  v_username text;
BEGIN
  v_username := lower(trim(coalesce(
    NEW.raw_user_meta_data->>'username',
    split_part(NEW.email, '@', 1)
  )));

  IF v_username = '' OR length(v_username) < 2 OR EXISTS (
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
