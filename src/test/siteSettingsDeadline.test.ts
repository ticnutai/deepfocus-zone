import { afterEach, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { from: () => {
  const chain = { select: () => chain, in: () => chain, abortSignal: mock.query };
  return chain;
} } }));
import { getSiteSettingValue } from '@/lib/siteSettingsCache';
afterEach(() => vi.useRealTimers());
it('unblocks a stalled settings fetch using persisted policy and permits a later retry', async () => {
  vi.useFakeTimers();
  Object.defineProperty(navigator, 'onLine', {configurable:true,value:true});
  const key='feature_blocklist_profiles_v1';
  const cached=[{id:'restricted',blocklist:{sections:['admin'],widgets:{}}}];
  localStorage.setItem('public-role-setting:'+key, JSON.stringify(cached));
  let finish!: (value: unknown) => void;
  mock.query.mockImplementationOnce(() => new Promise(resolve => {finish=resolve;}));
  const first=getSiteSettingValue(key,{force:true});
  await vi.advanceTimersByTimeAsync(8001);
  await expect(first).resolves.toEqual(cached);
  mock.query.mockResolvedValue({data:[{key,value:cached}],error:null});
  await expect(getSiteSettingValue(key,{force:true})).resolves.toEqual(cached);
  finish({data:[{key,value:[]}],error:null});
  await Promise.resolve();
  await expect(getSiteSettingValue(key)).resolves.toEqual(cached);
});
