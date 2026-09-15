/** Import provenance is not necessarily the current cloud owner. Never infer authorship from client tags. */
const labels: Record<string, string> = { shemesh: 'שמש בגבעון', 'question-lab': 'מעבדת שאלות', ai: 'יצירה בעזרת AI', builtin_joshua: 'מאגר יהושע' };
export function questionSources(tags: string[] = []): Array<{id:string;label:string}> {
  const ids = [...new Set(tags.filter(t => t.startsWith('source:') && !t.startsWith('source:client:')).map(t => t.slice(7)))];
  return ids.length ? ids.map(id => ({id, label: labels[id] ?? (/^(offline-|[a-f0-9]{8}-)/i.test(id) ? 'מקור מיובא' : id)})) : [{id:'unattributed',label:'ללא מקור מזוהה'}];
}
