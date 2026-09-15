import { useCallback, useEffect, useState } from 'react';
import { CheckCheck, RefreshCw } from 'lucide-react';
import { loadAdminSourceCatalog, sourceCatalogError } from '@/lib/study/adminSourceCatalog';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { questionSourceLabel } from '@/lib/study/questionSources';
import { QuestionCountBadge } from './QuestionCountBadge';
import { SourceApprovalControls, type SourceApprovalStats } from './SourceApprovalControls';
type Source = SourceApprovalStats & {source_id:string;question_count:number};
export function SourceApprovalsTab(){
 const [rows,setRows]=useState<Source[]>([]);const [search,setSearch]=useState('');const [loading,setLoading]=useState(true);const [error,setError]=useState('');
 const load=useCallback(async()=>{
  setLoading(true);setError('');
  try{setRows(await loadAdminSourceCatalog());}
  catch(error){setError(sourceCatalogError(error));}finally{setLoading(false);}
 },[]);
 useEffect(()=>{void load();},[load]);
 return <Card className="gold-frame space-y-4 p-4" dir="rtl">
  <div className="flex flex-wrap items-center justify-between gap-3"><h3 className="flex items-center gap-2 text-xl font-bold"><CheckCheck className="h-5 w-5 shrink-0 text-gold"/>אישור שאלות ומקורות</h3><Button variant="outline" disabled={loading} onClick={()=>void load()}><RefreshCw className="h-4 w-4 ml-1"/>רענן מקורות</Button></div>
  <p className="text-sm text-muted-foreground">כאן מאשרים שאלות בכל מאגר. האישור חל בכל הפרופילים שמאפשרים את המקור. בפרופילי הגישה בוחרים מי יוכל לראות אותו. שאלות מוסתרות ומחוקות אינן מאושרות בפעולה זו.</p>
  <Input aria-label="חיפוש מקור לאישור" placeholder="חפש מקור, למשל מאגר הישיבה…" value={search} onChange={e=>setSearch(e.target.value)}/>
  {error&&<p role="alert">{error}</p>}{loading&&<p role="status">טוען מקורות…</p>}
  <div className="grid min-w-0 gap-3 lg:grid-cols-2">{rows.filter(row=>questionSourceLabel(row.source_id).includes(search.trim())).map(row=><section key={row.source_id} className="min-w-0 space-y-3 rounded-xl border border-gold/30 p-3" aria-label={questionSourceLabel(row.source_id)}><div className="flex items-center justify-between gap-2"><h4 className="min-w-0 break-words font-semibold">{questionSourceLabel(row.source_id)}</h4><QuestionCountBadge count={Number(row.question_count)}/></div><SourceApprovalControls id={row.source_id} stats={row} onRefresh={load}/></section>)}{!loading&&!error&&!rows.some(row=>questionSourceLabel(row.source_id).includes(search.trim()))&&<p>לא נמצאו מקורות תואמים.</p>}</div>
 </Card>;
}
