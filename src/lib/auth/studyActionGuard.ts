import type { PermissionAction, PermissionModule } from '@/hooks/usePermissions';
import { isRolePreview } from './rolePreview';
export type PermissionCheck = (module: PermissionModule, action: PermissionAction) => boolean;

/** Stable wrappers read the current identity at invocation, including offline switches. */
export function createStudyActionGuard(readPermission: () => PermissionCheck, onDenied: () => void) {
  const wrappers = new WeakMap<object, Map<string, unknown>>();
  return <Args extends unknown[], Result>(module: PermissionModule, action: PermissionAction, operation: (...args: Args) => Result): ((...args: Args) => Result) => {
    const key = `${module}:${action}`;
    let byPermission = wrappers.get(operation);
    if (!byPermission) { byPermission = new Map(); wrappers.set(operation, byPermission); }
    if (!byPermission.has(key)) byPermission.set(key, (...args: Args): Result => {
      if (isRolePreview() || !readPermission()(module, action)) {
        onDenied();
        throw new Error('אין הרשאה לפעולה זו בתפקיד הנוכחי');
      }
      return operation(...args);
    });
    return byPermission.get(key) as (...args: Args) => Result;
  };
}
