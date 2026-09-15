import { renderHook, act } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useTouchHold } from '@/hooks/useTouchHold';
afterEach(()=>vi.useRealTimers());
it('opens only after a stationary touch hold, never on mouse or a short tap',()=>{
  vi.useFakeTimers(); const open=vi.fn(); const {result}=renderHook(()=>useTouchHold());
  const handlers=result.current(true,open);
  act(()=>{handlers.onPointerDown({pointerType:'mouse',clientX:0,clientY:0} as any);vi.advanceTimersByTime(650);});
  expect(open).not.toHaveBeenCalled();
  act(()=>{handlers.onPointerDown({pointerType:'touch',clientX:0,clientY:0} as any);handlers.onPointerUp();vi.advanceTimersByTime(650);});
  expect(open).not.toHaveBeenCalled();
  act(()=>{handlers.onPointerDown({pointerType:'touch',clientX:0,clientY:0} as any);vi.advanceTimersByTime(650);});
  expect(open).toHaveBeenCalledOnce();
});
it('cancels for movement, scroll, pointer cancellation and missing permission',()=>{
  vi.useFakeTimers();const open=vi.fn();const {result}=renderHook(()=>useTouchHold());
  for(const reason of ['move','scroll','cancel','permission']){
    const h=result.current(reason!=='permission',open);
    act(()=>{h.onPointerDown({pointerType:'touch',clientX:0,clientY:0} as any);
      if(reason==='move')h.onPointerMove({clientX:0,clientY:30} as any);
      if(reason==='scroll')window.dispatchEvent(new Event('scroll'));
      if(reason==='cancel')h.onPointerCancel();
      vi.advanceTimersByTime(650);
    });
  }
  expect(open).not.toHaveBeenCalled();
});
