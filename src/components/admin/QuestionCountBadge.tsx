import { ListChecks } from 'lucide-react';
export function QuestionCountBadge({count}:{count?:number}) {
 const known=typeof count==='number' && Number.isFinite(count) && count>=0;
 const label=known?`${count.toLocaleString('he-IL')} שאלות`:'כמות שאלות לא זמינה';
 return <span title={`${label} במאגר, ללא שאלות שנמחקו`} aria-label={label} className="inline-flex shrink-0 items-center gap-1 rounded-full border border-gold/40 bg-gold/10 px-2 py-1 text-xs font-semibold text-foreground tabular-nums">
  <ListChecks aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-gold"/><span dir="ltr">{known?count.toLocaleString('he-IL'):'—'}</span>
 </span>;
}
