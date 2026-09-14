import { describe, expect, it } from 'vitest';
import { nativeBarAppearance } from '@/lib/nativeThemeBars';
describe('native system bar theme', () => {
  it('uses dark icons for a light app background', () => {
    expect(nativeBarAppearance('rgb(250, 249, 247)')).toEqual({color:'#faf9f7', darkIcons:true});
  });
  it('uses light icons for navy', () => {
    expect(nativeBarAppearance('rgb(15, 23, 42)')).toEqual({color:'#0f172a', darkIcons:false});
  });
});
