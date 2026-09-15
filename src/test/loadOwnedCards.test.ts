import {expect,it,vi} from 'vitest';
import {loadOwnedCardPages} from '@/lib/study/loadOwnedCards';
it('keeps the authenticated owner and retrieves every page',async()=>{
 const read=vi.fn().mockResolvedValueOnce({data:[1,2],error:null}).mockResolvedValueOnce({data:[3],error:null});
 expect(await loadOwnedCardPages('admin',read,2)).toEqual([1,2,3]);
 expect(read.mock.calls).toEqual([['admin',0,1],['admin',2,3]]);
});
it('does not return incomplete data when a later page fails',async()=>{
 const read=vi.fn().mockResolvedValueOnce({data:[1,2],error:null}).mockResolvedValueOnce({data:null,error:Error('timeout')});
 await expect(loadOwnedCardPages('admin',read,2)).rejects.toThrow('timeout');
});
it('rejects an unscoped request before contacting the database',async()=>{
 const read=vi.fn();await expect(loadOwnedCardPages('',read)).rejects.toThrow();expect(read).not.toHaveBeenCalled();
});
