import { render, screen, waitFor, cleanup } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { GemaraViewer } from '@/components/study/GemaraViewer';
vi.mock('@/lib/study/store', () => ({ useStudy: () => ({ state: {}, setUiPref: vi.fn() }) }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { storage: { from: () => ({ getPublicUrl: (path: string) => ({ data: { publicUrl: `https://example.test/${path}` } }) }) } } }));
vi.mock('@/lib/study/sefaria', () => ({ fetchSefariaDaf: vi.fn(async () => ['טקסט גמרא']), sefariaUrl: () => '#', isSefariaSupported: () => true, masechtaSlug: () => 'Shabbat' }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
it('does not mount a remote document while its PDF check is pending', () => {
  vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})));
  const { container } = render(<GemaraViewer masechta="שבת" daf={2} amud={1} />);
  expect(container.querySelector('iframe')).toBeNull();
  expect(screen.getByRole('status')).toBeInTheDocument();
});
it.each([[false, 'application/json'], [true, 'text/html']])('rejects non-PDF responses (ok=%s, type=%s)', async (ok, type) => {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok, headers: new Headers({ 'content-type': type }) })));
  const { container } = render(<GemaraViewer masechta="שבת" daf={2} amud={1} />);
  await screen.findByText('טקסט גמרא');
  expect(container.querySelector('iframe')).toBeNull();
});
it('mounts a verified PDF but removes it immediately when changing daf', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce({ ok: true, headers: new Headers({ 'content-type': 'application/pdf' }) }).mockImplementation(() => new Promise(() => {})));
  const { container, rerender } = render(<GemaraViewer masechta="שבת" daf={2} amud={1} />);
  await waitFor(() => expect(container.querySelector('iframe')).not.toBeNull());
  rerender(<GemaraViewer masechta="שבת" daf={3} amud={1} />);
  expect(container.querySelector('iframe')).toBeNull();
});
