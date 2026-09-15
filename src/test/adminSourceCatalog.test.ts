import {beforeEach,expect,it,vi} from 'vitest';
const {rpc,getSession}=vi.hoisted(()=>({rpc:vi.fn(),getSession:vi.fn()}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{rpc,auth:{getSession}}}));
import {invalidateAdminSourceCatalog,loadAdminSourceCatalog,sourceCatalogError} from '@/lib/study/adminSourceCatalog';
beforeEach(()=>{invalidateAdminSourceCatalog();rpc.mockReset();getSession.mockReset().mockResolvedValue({data:{session:{user:{id:'admin'}}}});});
it('deduplicates simultaneous callers but refresh fetches current counts',async()=>{
 let finish!:(value:unknown)=>void;rpc.mockReturnValueOnce(new Promise(r=>finish=r));
 const a=loadAdminSourceCatalog(),b=loadAdminSourceCatalog();await Promise.resolve();
 expect(rpc).toHaveBeenCalledTimes(1);finish({data:[{source_id:'yeshiva',question_count:3518}],error:null});
 expect(await a).toEqual(await b);
 rpc.mockResolvedValue({data:[],error:null});await loadAdminSourceCatalog();expect(rpc).toHaveBeenCalledTimes(2);
});
it('failed request can retry without retaining a failed promise',async()=>{
 rpc.mockResolvedValueOnce({data:null,error:{code:'57014'}}).mockResolvedValueOnce({data:[],error:null});
 await expect(loadAdminSourceCatalog()).rejects.toEqual({code:'57014'});await expect(loadAdminSourceCatalog()).resolves.toEqual([]);
});
it('does not load without a session and explains timeout',async()=>{
 getSession.mockResolvedValue({data:{session:null}});await expect(loadAdminSourceCatalog()).rejects.toThrow();expect(rpc).not.toHaveBeenCalled();
 expect(sourceCatalogError({code:'57014'})).toContain('יותר מדי זמן');
});
