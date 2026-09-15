import { useEffect, useRef, useState } from 'react';
import { CheckCheck, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { questionSourceLabel } from '@/lib/study/questionSources';
import { invalidateAdminSourceCatalog } from '@/lib/study/adminSourceCatalog';
import { approveSourceBatches, approvalErrorMessage } from '@/lib/study/approveSourceBatches';
export type SourceApprovalStats = { approved_count:number; pending_count:number; hidden_count:number; auto_approve:boolean };
export function SourceApprovalControls({id,stats,onRefresh}:{id:string;stats:SourceApprovalStats;onRefresh:()=>Promise<void>}) {
 const [action,setAction]=useState<'approve'|'auto'|null>(null);
 const [busy,setBusy]=useState(false);
 const [processed,setProcessed]=useState(0);
 const [failure,setFailure]=useState('');
 const stopping=useRef(false);const running=useRef(false);
 useEffect(()=>()=>{stopping.current=true;},[]);
 async function execute(){
  if(running.current)return;running.current=true;stopping.current=false;setFailure('');setProcessed(0);
  setBusy(true);
  try {
   if(action==='approve'){
    const result=await approveSourceBatches(()=> (supabase.rpc as Function)('admin_approve_question_source',{p_source_id:id}),setProcessed,()=>stopping.current);
    toast.success(result.completed?`${result.total.toLocaleString('he-IL')} שאלות אושרו; לא נותרו ממתינות`:`הפעולה הושהתה. ${result.total.toLocaleString('he-IL')} שאלות אושרו ונשמרו`);
   }else{
    const result=await (supabase.rpc as Function)('admin_set_source_auto_approval',{p_source_id:id,p_enabled:!stats.auto_approve});if(result.error)throw result.error;
    toast.success('הגדרת האישור האוטומטי נשמרה');
   }
   invalidateAdminSourceCatalog();
   setAction(null);
   await onRefresh();
  }catch(error){const message=approvalErrorMessage(error);setFailure(message);toast.error(message);invalidateAdminSourceCatalog();}finally{setBusy(false);running.current=false;}
 }
 return <div className="space-y-2 border-t pt-2 text-xs">
  <div className="flex flex-wrap gap-x-3 gap-y-1"><span>מאושרות: {Number(stats.approved_count).toLocaleString('he-IL')}</span><span>ממתינות: {Number(stats.pending_count).toLocaleString('he-IL')}</span><span>מוסתרות: {Number(stats.hidden_count).toLocaleString('he-IL')}</span></div>
  <div className="flex flex-wrap gap-2">
   <Button type="button" size="sm" variant="outline" disabled={busy||!Number(stats.pending_count)} onClick={()=>setAction('approve')}><CheckCheck className="h-4 w-4 ml-1 shrink-0"/>אשר את כל הממתינות</Button>
   <Button type="button" size="sm" variant="outline" disabled={busy} onClick={()=>setAction('auto')}>אישור אוטומטי בייבוא מנהל: {stats.auto_approve?'פעיל':'כבוי'}</Button>
  </div>
  <Dialog open={action!==null} onOpenChange={open=>{if(!open&&!busy)setAction(null);}}><DialogContent dir="rtl" className="max-w-[calc(100vw-2rem)] sm:max-w-md"><DialogHeader>
   <DialogTitle>{action==='approve'?'אישור שאלות המאגר':'אישור אוטומטי'} — {questionSourceLabel(id)}</DialogTitle>
   <DialogDescription>{action==='approve'?`לאשר את כל ${Number(stats.pending_count).toLocaleString('he-IL')} השאלות הממתינות במקור? האישור חל בכל הפרופילים שמאפשרים מקור זה, ולא רק בפרופיל הנערך. שאלות מוסתרות או מחוקות לא ישתנו. הבעלות והסיווג יישמרו.`:stats.auto_approve?'לכבות אישור אוטומטי לשאלות חדשות? שאלות שכבר אושרו יישארו מאושרות.':'שאלות חדשות שמנהל יוסיף או ייבא למקור יאושרו אוטומטית. שאלות קיימות וטיוטות של משתמשים אחרים לא יאושרו בפעולה זו.'}</DialogDescription>
  </DialogHeader>
  {action==='approve'&&(busy||processed>0)&&<div role="status" className="space-y-2"><p>אושרו בריצה זו: {processed.toLocaleString('he-IL')} — במנות של עד 100 שאלות</p><progress className="w-full" value={processed} max={Math.max(Number(stats.pending_count),processed,1)}/><p className="text-xs text-muted-foreground">אפשר להשהות ולהמשיך אחר כך. כל מנה שהושלמה נשמרת בענן.</p></div>}
  {failure&&<p role="alert" className="break-words text-sm text-destructive">{failure}</p>}
  <DialogFooter className="gap-2"><Button type="button" variant="outline" onClick={()=>{if(busy)stopping.current=true;else setAction(null);}}>{busy?'השהה אחרי המנה הנוכחית':'סגור'}</Button><Button type="button" disabled={busy} onClick={()=>void execute()}>{busy&&<Loader2 className="h-4 w-4 animate-spin ml-1"/>}{failure?'המשך מהשאלות שנותרו':'אישור הפעולה'}</Button></DialogFooter></DialogContent></Dialog>
 </div>;
}
