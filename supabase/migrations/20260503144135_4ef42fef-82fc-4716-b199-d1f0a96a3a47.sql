-- Fix NULL string columns in auth.users that break GoTrue scanning during OAuth login.
-- Apply globally to prevent future occurrences.
UPDATE auth.users
SET
  email_change = COALESCE(email_change, ''),
  email_change_token_new = COALESCE(email_change_token_new, ''),
  email_change_token_current = COALESCE(email_change_token_current, ''),
  confirmation_token = COALESCE(confirmation_token, ''),
  recovery_token = COALESCE(recovery_token, ''),
  reauthentication_token = COALESCE(reauthentication_token, ''),
  phone_change = COALESCE(phone_change, ''),
  phone_change_token = COALESCE(phone_change_token, '')
WHERE
  email_change IS NULL
  OR email_change_token_new IS NULL
  OR email_change_token_current IS NULL
  OR confirmation_token IS NULL
  OR recovery_token IS NULL
  OR reauthentication_token IS NULL
  OR phone_change IS NULL
  OR phone_change_token IS NULL;