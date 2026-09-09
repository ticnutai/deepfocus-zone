import { describe, expect, it, vi } from 'vitest';
import { createStudyActionGuard } from '@/lib/auth/studyActionGuard';
describe('role action enforcement', () => {
  it('keeps administrator previews read-only', () => {
    window.history.replaceState({}, '', '/?previewRole=test-role');
    try {
      const operation = vi.fn();
      const guard = createStudyActionGuard(() => () => true, vi.fn());
      expect(() => guard('cards','edit',operation)()).toThrow();
      expect(operation).not.toHaveBeenCalled();
    } finally { window.history.replaceState({}, '', '/'); }
  });
  it('blocks disabled actions before they mutate data', () => {
    const operation = vi.fn(); const denied = vi.fn();
    const guard = createStudyActionGuard(() => () => false, denied);
    expect(() => guard('cards','delete',operation)('question-id')).toThrow('אין הרשאה');
    expect(operation).not.toHaveBeenCalled();
    expect(denied).toHaveBeenCalledOnce();
  });
  it('keeps callback identity stable while checking the latest permissions', () => {
    let permitted = true;
    const guard = createStudyActionGuard(() => () => permitted, vi.fn());
    const operation = vi.fn((text: string) => text);
    const wrapped = guard('cards','create',operation);
    expect(wrapped).toBe(guard('cards','create',operation));
    expect(wrapped('new question')).toBe('new question');
    permitted = false;
    expect(() => wrapped('forbidden')).toThrow();
    expect(operation).toHaveBeenCalledOnce();
  });
});
