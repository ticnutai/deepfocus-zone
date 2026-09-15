import { supabase } from '@/integrations/supabase/client';
export type AdminSource = {source_id:string;question_count:number;approved_count:number;pending_count:number;hidden_count:number;auto_approve:boolean};
// In-memory only, scoped to the authenticated account. Never persist admin data.
let pending:Promise<AdminSource[]>|undefined;
let owner:string|undefined;
let epoch=0;
export function invalidateAdminSourceCatalog(){epoch++;pending=undefined;}
export async function loadAdminSourceCatalog():Promise<AdminSource[]>{
 const {data}=await supabase.auth.getSession();
 const id=data.session?.user.id;
 if(!id){owner=undefined;invalidateAdminSourceCatalog();throw new Error('יש להתחבר מחדש כמנהל.');}
 if(owner!==id){owner=id;invalidateAdminSourceCatalog();}
 if(pending)return pending;
 const current=epoch;
 const request=(async()=>{
  const {data,error}=await (supabase.rpc as Function)('get_admin_question_source_tags');
  if(error)throw error;
  return (data??[]) as AdminSource[];
 })();
 pending=request;
 try{return await request;}finally{if(epoch===current&&pending===request)pending=undefined;}
}
export function sourceCatalogError(error:unknown){
 const e=error as {code?:string;message?:string};
 if(e?.code==='57014'||/timeout/i.test(e?.message??''))return 'הספירה בענן ארכה יותר מדי זמן. הנתונים הקודמים נשמרו; לחץ על רענן מקורות כדי לנסות שוב.';
 if(e?.code==='42501')return 'אין הרשאת מנהל לטעינת המקורות. התחבר מחדש עם חשבון מנהל.';
 return `טעינת המקורות נכשלה. ${e?.message||'בדוק את החיבור ונסה לרענן.'}`;
}
