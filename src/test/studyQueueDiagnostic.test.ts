// Diagnostic: exercise the current production queue expression without the session UI.
import {readFileSync} from 'node:fs';
import {useMemo} from 'react';
import {renderHook} from '@testing-library/react';
import {it,expect,vi} from 'vitest';

it('keeps the running queue stable across equivalent refreshed question lists',()=>{
 const source=readFileSync('src/components/study/StudySession.tsx','utf8');
 const expression=source.slice(source.indexOf('  const cardIdsKey ='),source.indexOf('  const [retryCardIds,'));
 const js=`function useQueue(state,cardIds){const deckId=null,mode='practice',comboPrefForQueue='both';${expression.replace('let cards: StudyCard[]','let cards')}return baseQueue;}`;
 const useQueue=new Function('useMemo',`${js};return useQueue;`)(useMemo);
 const random=vi.spyOn(Math,'random').mockReturnValue(0.9);
 try {
  const state={cards:[{id:'a'},{id:'b'},{id:'c'}]}; const ids=['a','b','c'];
  const view=renderHook(({ids})=>useQueue(state,ids),{initialProps:{ids}});
  const first=view.result.current;const calls=random.mock.calls.length;
  view.rerender({ids});expect(view.result.current).toBe(first);
  random.mockReturnValue(0.1);
  view.rerender({ids:[...ids]});
  expect(random.mock.calls.length).toBe(calls);
  expect(view.result.current).toBe(first);
  for(let i=0;i<50;i++)view.rerender({ids:['c','b','a','a']});
  expect(view.result.current).toBe(first);
  expect(random.mock.calls.length).toBe(calls);
  view.rerender({ids:['b','c']});
  expect(view.result.current.map((c:{id:string})=>c.id).sort()).toEqual(['b','c']);
 } finally {random.mockRestore();}
});
