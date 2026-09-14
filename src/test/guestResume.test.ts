import { beforeEach, expect, it } from 'vitest';
import { getGuestResumePath, rememberGuestResumePath } from '@/lib/auth/guestResume';
beforeEach(() => { localStorage.clear(); window.history.replaceState({}, '', '/'); });
it('remembers the guest study route across a logout page change', () => {
  window.history.replaceState({}, '', '/?section=daf');
  rememberGuestResumePath();
  window.history.replaceState({}, '', '/auth');
  expect(getGuestResumePath()).toBe('/?section=daf');
});
it('supports desktop hash routing', () => {
  window.history.replaceState({}, '', '/#/plan/123');
  rememberGuestResumePath();
  expect(getGuestResumePath()).toBe('/plan/123');
});
it.each(['//evil.test', 'https://evil.test', '/auth', '/\\evil.test'])('rejects unsafe resume path %s', path => {
  localStorage.setItem('guest-resume-path:v1', path);
  expect(getGuestResumePath()).toBeNull();
});
