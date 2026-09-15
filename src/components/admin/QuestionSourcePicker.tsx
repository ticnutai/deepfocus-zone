import { useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { questionSourceLabel } from '@/lib/study/questionSources';
import { QuestionCountBadge } from './QuestionCountBadge';
export function QuestionSourcePicker({sources,counts={},selected,onChange,renderActions}:{sources:string[];counts?:Record<string,number>;selected?:string[]|null;onChange:(ids:string[]|null)=>void;renderActions?:(id:string)=>ReactNode}) {
 const [open,setOpen]=useState(false); const [search,setSearch]=useState('');
 const options=[...new Set([...sources,...(selected??[])])];
 return <div className="mt-4 rounded-xl border border-gold/30 p-3" dir="rtl">
  <Button type="button" variant="outline" aria-expanded={open} onClick={()=>setOpen(!open)}>מקורות השאלות — {selected?.length ?? 0} נבחרו</Button>
  {open&&<div className="mt-3 space-y-3">
   <p className="text-xs text-muted-foreground">המקורות שנבחרו מתווספים למשתמשים שתבחר בהמשך. לדוגמה: מאגר הישיבה וגם שאלות של חשבון מסוים. אין צורך לבחור את בעל המקור או להפעיל את כל הספרייה. כללי האישור וההסתרה ממשיכים לחול.</p>
   <div className="flex gap-2"><Button type="button" variant="outline" onClick={()=>onChange(options)}>בחר הכול</Button><Button type="button" variant="outline" onClick={()=>onChange([])}>נקה הכול</Button></div>
   <Input aria-label="חיפוש מקור" placeholder="חיפוש מקור…" value={search} onChange={e=>setSearch(e.target.value)}/>
   <div className="max-h-96 overflow-y-auto space-y-2">{options.filter(id=>questionSourceLabel(id).includes(search)).map(id=><div key={id} className="rounded-lg border p-3 space-y-2"><label className="flex items-center gap-3"><Checkbox checked={selected?.includes(id)??false} onCheckedChange={checked=>{const next=new Set(selected??[]);if(checked)next.add(id);else next.delete(id);onChange([...next]);}}/><span className="min-w-0 flex-1 break-words">{questionSourceLabel(id)}{['מקור משתמש','מקור מיובא'].includes(questionSourceLabel(id))?` ${options.indexOf(id)+1}`:''}</span><QuestionCountBadge count={counts[id]}/></label>{renderActions?.(id)}</div>)}</div>
  </div>}
 </div>;
}
