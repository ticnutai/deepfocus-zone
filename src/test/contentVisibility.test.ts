import { afterEach, describe, expect, it, vi } from 'vitest';
import { hiddenCardIds, setPersonalCardHidden } from '@/lib/study/contentVisibility';
describe('personal content visibility', () => {
  afterEach(() => vi.restoreAllMocks());
  it('keeps offline hide and restore separate from question deletion', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    await setPersonalCardHidden('local-test-a', 'question-a', true);
    expect(hiddenCardIds('local-test-a').has('question-a')).toBe(true);
    expect(hiddenCardIds('local-test-b').has('question-a')).toBe(false);
    const cache = JSON.parse(localStorage.getItem('content-visibility:v1:local-test-a')!);
    expect(cache.pending['question-a']).toBe(true);
    await setPersonalCardHidden('local-test-a', 'question-a', false);
    expect(hiddenCardIds('local-test-a').has('question-a')).toBe(false);
  });
  it('personal restore cannot override an administrator hide', () => {
    localStorage.setItem('content-visibility:v1:local-test-c', JSON.stringify({
      rules: [{ card_id: 'q', target_user_id: null, scope: 'admin' }], pending: { q: false },
    }));
    expect(hiddenCardIds('local-test-c').has('q')).toBe(true);
    expect(hiddenCardIds('local-test-c', true).has('q')).toBe(false);
  });
});
