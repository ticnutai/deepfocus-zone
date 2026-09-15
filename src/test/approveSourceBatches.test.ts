import {expect,it,vi} from 'vitest';
import {approveSourceBatches,approvalErrorMessage} from '@/lib/study/approveSourceBatches';
it('approves a 17453-card source in bounded sequential requests',async()=>{
 let remaining=17453;const progress=vi.fn();const call=vi.fn(async()=>{const count=Math.min(100,remaining);remaining-=count;return {data:count,error:null};});
 expect(await approveSourceBatches(call,progress,()=>false)).toEqual({total:17453,completed:true});expect(call).toHaveBeenCalledTimes(176);expect(progress).toHaveBeenLastCalledWith(17453);
});
it('stops on error and resumes using only server-side pending cards',async()=>{
 let remaining=250;let fail=true;
 const call=async()=>{if(remaining===150&&fail){fail=false;return {data:null,error:{code:'57014',message:'statement timeout'}};}const count=Math.min(100,remaining);remaining-=count;return {data:count,error:null};};
 await expect(approveSourceBatches(call,()=>{},()=>false)).rejects.toMatchObject({code:'57014'});
 expect(await approveSourceBatches(call,()=>{},()=>false)).toEqual({total:150,completed:true});
 expect(approvalErrorMessage({code:'57014',message:'statement timeout'})).toContain('57014');
});
it('pauses between batches without sending another request',async()=>{
 let stop=false;const call=vi.fn(async()=>({data:100,error:null}));
 expect(await approveSourceBatches(call,()=>{stop=true;},()=>stop)).toEqual({total:100,completed:false});expect(call).toHaveBeenCalledOnce();
});
