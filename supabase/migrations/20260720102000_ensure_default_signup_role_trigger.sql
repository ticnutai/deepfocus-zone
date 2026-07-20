-- Database drift can leave the default-role function in place without its
-- auth.users trigger. Recreate the trigger so every new signup is assigned
-- the currently configured default role.
DROP TRIGGER IF EXISTS on_auth_user_assign_role ON auth.users;

CREATE TRIGGER on_auth_user_assign_role
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.assign_default_role();
