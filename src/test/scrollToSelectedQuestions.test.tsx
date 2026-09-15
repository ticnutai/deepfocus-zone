import {renderHook,act} from '@testing-library/react';
import {it,expect,vi,afterEach} from 'vitest';
import {useScrollToSelectedQuestions} from '@/hooks/useScrollToSelectedQuestions';
afterEach(()=>vi.restoreAllMocks());
it('scrolls only for confirmed selections and cancels obsolete requests',()=>{
  let callback:FrameRequestCallback=()=>{};
  vi.spyOn(window,'requestAnimationFrame').mockImplementation(cb=>{callback=cb;return 7;});
  const cancel=vi.spyOn(window,'cancelAnimationFrame').mockImplementation(()=>{});
  const scroll=vi.fn();
  const {result,rerender,unmount}=renderHook(({confirmed,key})=>useScrollToSelectedQuestions(confirmed,key),{initialProps:{confirmed:false,key:'chapter'}});
  expect(requestAnimationFrame).not.toHaveBeenCalled();
  rerender({confirmed:false,key:'verse'});expect(requestAnimationFrame).not.toHaveBeenCalled();
  result.current.current={scrollIntoView:scroll} as unknown as HTMLDivElement;
  rerender({confirmed:true,key:'verse1'});act(()=>callback(0));expect(scroll).toHaveBeenCalledTimes(1);
  rerender({confirmed:true,key:'verse1'});expect(requestAnimationFrame).toHaveBeenCalledTimes(1);
  rerender({confirmed:true,key:'verse2'});expect(cancel).toHaveBeenCalledWith(7);act(()=>callback(0));expect(scroll).toHaveBeenCalledTimes(2);
  unmount();expect(cancel).toHaveBeenCalled();
});
