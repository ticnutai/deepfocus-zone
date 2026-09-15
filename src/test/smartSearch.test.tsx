import { fireEvent, render, screen, cleanup } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { SmartSearch } from '@/components/study/SmartSearch';
import { questionSources } from '@/lib/study/questionSources';

const mocks = vi.hoisted(() => ({ admin: true, remove: vi.fn(), count: 0 }));
vi.mock('@/hooks/usePermissions', () => ({ usePermissions: () => ({ isAdmin: mocks.admin }) }));
vi.mock('@/hooks/use-mobile', () => ({ useIsMobile: () => false }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { rpc: async () => ({ data: [{ source_user_id: 'alice', label: 'אליס' }] }) } }));
vi.mock('@/lib/study/store', () => ({ cardSourceOwner: () => undefined, useStudy: () => ({ deleteCard: mocks.remove, state: {
  cards: Array.from({length: 320}, (_, i) => ({ id: String(i), creatorId: i % 2 ? 'bob' : 'alice', question: `בדיקה ${i}`, type: 'flashcard', answer: 'תשובה', deckId: 'd', tags: [i % 2 ? 'source:ai' : 'source:shemesh'], stats: {totalReviews:0, correct:0, incorrect:0}, srs: {due:0} })), decks: [], categories: []
} }) }));
vi.mock('@tanstack/react-virtual', () => ({ useVirtualizer: (options: {count:number}) => {
  mocks.count = options.count;
  return { getTotalSize: () => options.count * 110, getVirtualItems: () => Array.from({length:Math.min(8, options.count)}, (_, index) => ({index,start:index*110})), measureElement: () => {}, scrollToOffset: () => {} };
} }));
afterEach(() => { cleanup(); mocks.admin = true; mocks.remove.mockClear(); });
it('retains more than 80 browse and 200 search results while rendering only virtual rows', () => {
  const {container} = render(<SmartSearch />);
  expect(screen.getByText('שאלה: 320')).toBeInTheDocument();
  expect(container.querySelectorAll('[data-search-result]')).toHaveLength(8);
  fireEvent.change(screen.getByPlaceholderText(/חפש שאלות/), {target:{value:'בדיקה'}});
  expect(screen.getByText('שאלה: 320')).toBeInTheDocument();
});
it('filters import provenance and authenticated creator independently', async () => {
  render(<SmartSearch />);
  await screen.findByText('אליס');
  fireEvent.change(screen.getByLabelText('מקור השאלות'), {target:{value:'shemesh'}});
  expect(screen.getByText('שאלה: 160')).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('נוסף על ידי'), {target:{value:'alice'}});
  expect(screen.getByText('שאלה: 160')).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('מקור השאלות'), {target:{value:'ai'}});
  expect(screen.getByText('אין תוצאות')).toBeInTheDocument();
});
it('requires confirmation and delegates exact card id to existing deletion', () => {
  const pick = vi.fn(); render(<SmartSearch onPick={pick} />);
  fireEvent.click(screen.getByLabelText('מחק שאלה: בדיקה 0'));
  expect(mocks.remove).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText('ביטול'));
  expect(mocks.remove).not.toHaveBeenCalled();
  fireEvent.click(screen.getByLabelText('מחק שאלה: בדיקה 0'));
  fireEvent.click(screen.getByText('מחק שאלה'));
  expect(mocks.remove).toHaveBeenCalledWith('0'); expect(pick).not.toHaveBeenCalled();
});
it('does not expose administrative deletion or user catalog to ordinary users', () => {
  mocks.admin = false; render(<SmartSearch variant="modal" />);
  expect(screen.queryByLabelText(/מחק שאלה:/)).toBeNull();
  expect(screen.queryByLabelText('נוסף על ידי')).toBeNull();
});
it('deduplicates sources and does not mistake client device for authorship', () => {
  expect(questionSources(['source:shemesh','source:shemesh','source:client:desktop'])).toEqual([{id:'shemesh',label:'שמש בגבעון'}]);
  expect(questionSources(['source:client:mobile'])).toEqual([{id:'unattributed',label:'ללא מקור מזוהה'}]);
});
