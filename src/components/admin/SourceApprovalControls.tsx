import { useState } from 'react';
import { CheckCheck, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { questionSourceLabel } from '@/lib/study/questionSources';
import { invalidateAdminSourceCatalog } from '@/lib/study/adminSourceCatalog';
export type SourceApprovalStats = { approved_count:number; pending_count:number; hidden_count:number; auto_approve:boolean };
export function SourceApprovalControls({id,stats,onRefresh}:{id:string;stats:SourceApprovalStats;onRefresh:()=>Promise<void>}) {
 const [action,setAction]=useState<'approve'|'auto'|null>(null);
 const [busy,setBusy]=useState(false);
 async function execute(){
  setBusy(true);
  try {
   const result=await (supabase.rpc as Function)(action==='approve'?'admin_approve_question_source':'admin_set_source_auto_approval',action==='approve'?{p_source_id:id}:{p_source_id:id,p_enabled:!stats.auto_approve});
   if(result.error)throw result.error;
   invalidateAdminSourceCatalog();
   toast.success(action==='approve'?`${Number(result.data).toLocaleString('he-IL')} שאלות אושרו`:'הגדרת האישור האוטומטי נשמרה');
   setAction(null);
   await onRefresh();
  }catch(error){toast.error(error instanceof Error?error.message:'הפעולה נכשלה — נסה שוב');}finally{setBusy(false);}
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
  </DialogHeader><DialogFooter className="gap-2"><Button type="button" variant="outline" disabled={busy} onClick={()=>setAction(null)}>ביטול</Button><Button type="button" disabled={busy} onClick={()=>void execute()}>{busy&&<Loader2 className="h-4 w-4 animate-spin ml-1"/>}אישור הפעולה</Button></DialogFooter></DialogContent></Dialog>
 </div>;
}
