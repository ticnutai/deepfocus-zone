import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ release: null as null | (()=>void), wait: false, keys: [] as string[] }));
vi.mock('@/lib/siteSettingsCache', () => ({
 updateSiteSettingCache: vi.fn(),
 getSiteSettingValue: async (key: string) => {
   state.keys.push(key);
   if (state.wait) await new Promise<void>(resolve => { state.release = resolve; });
   if (key === 'feature_blocklist') return {sections:['pdf','monitor','achievements'],widgets:{}};
   return [];
 },
}));
import { useResolvedFeatureBlocklist } from '@/lib/study/featureBlocklist';
describe('role visibility on every viewport', () => {
 it('starts closed, uses desktop visibility on mobile, and does not leak the previous identity', async () => {
   const hook=renderHook(({roles})=>useResolvedFeatureBlocklist(roles,{scope:'mobile'}), {initialProps:{roles:['test-role']}});
   expect(hook.result.current.sections).toContain('pdf');
   expect(hook.result.current.sections).toContain('questions');
   await waitFor(()=>expect(hook.result.current.sections).not.toContain('questions'));
   expect(hook.result.current.sections).toEqual(['pdf','monitor','achievements']);
   expect(state.keys.some(k=>k.includes('mobile'))).toBe(false);
   state.wait=true;
   act(()=>hook.rerender({roles:['different-role']}));
   expect(hook.result.current.sections).toContain('questions');
   hook.unmount();
 });
});
