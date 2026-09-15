/** Import provenance is not necessarily the current cloud owner. Never infer authorship from client tags. */
const labels: Record<string, string> = { shemesh: 'שמש בגבעון', 'question-lab': 'מעבדת שאלות', ai: 'יצירה בעזרת AI', builtin_joshua: 'מאגר יהושע', custom: 'מקור מותאם אישית', site_library: 'ספריית האתר', yeshiva: 'מאגר הישיבה', unattributed: 'ללא מקור מזוהה' };
export function questionSourceLabel(id: string) { return labels[id] ?? (/^(user:|offline-|[a-f0-9]{8}-)/i.test(id) ? 'מקור משתמש' : 'מקור מיובא'); }
export function matchesQuestionSources(tags: string[] = [], selected?: string[] | null) { return selected == null || questionSources(tags).some(source => selected.includes(source.id)); }
/** Profile sources and contributors are independent positive selections (OR). */
export function matchesContentSelection(tags: string[], creator: string | undefined, sources: string[] | null, users: string[], library: boolean) {
  // null preserves legacy unfiltered library profiles; [] explicitly permits no sources.
  return (library && sources === null) || (!!creator && users.includes(creator)) || matchesQuestionSources(tags, sources ?? []);
}
export function questionSources(tags: string[] = []): Array<{id:string;label:string}> {
  const ids = [...new Set(tags.filter(t => t.startsWith('source:') && !t.startsWith('source:client:')).map(t => t.slice(7)))];
  return ids.length ? ids.map(id => ({id, label: questionSourceLabel(id)})) : [{id:'unattributed',label:'ללא מקור מזוהה'}];
}
