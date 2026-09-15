import {useState} from 'react';
import {fireEvent,render,screen} from '@testing-library/react';
import {expect,it} from 'vitest';
import {QuestionSourcePicker} from '@/components/admin/QuestionSourcePicker';
import {matchesQuestionSources,matchesContentSelection} from '@/lib/study/questionSources';
import {normalizeContentAccessProfile} from '@/lib/study/layoutProfiles';
it('supports multiple sources, all and none without losing selections during search',()=>{
 function Fixture(){const [ids,setIds]=useState<string[]|null>([]);return <><QuestionSourcePicker sources={['ai','shemesh']} selected={ids} onChange={setIds}/><output>{JSON.stringify(ids)}</output></>;}
 render(<Fixture/>);fireEvent.click(screen.getByRole('button',{name:/מקורות השאלות/}));
 fireEvent.click(screen.getByText('שמש בגבעון'));expect(screen.getByRole('status')).toHaveTextContent('["shemesh"]');
 fireEvent.click(screen.getByText('יצירה בעזרת AI'));expect(screen.getByRole('status')).toHaveTextContent('ai');
 fireEvent.change(screen.getByLabelText('חיפוש מקור'),{target:{value:'שמש'}});
 fireEvent.click(screen.getByText('נקה הכול'));expect(screen.getByRole('status')).toHaveTextContent('[]');
 fireEvent.click(screen.getByText('בחר הכול'));expect(screen.getByRole('status')).toHaveTextContent('["ai","shemesh"]');
});
it('unions provenance and contributor selections without including unrelated questions',()=>{
 const cards=[{id:1,tags:['source:yeshiva'],creator:'B'},{id:2,tags:['source:ai'],creator:'A'},{id:3,tags:['source:yeshiva'],creator:'A'},{id:4,tags:['source:ai'],creator:'B'}];
 const select=(sources:string[],users:string[])=>cards.filter(c=>matchesContentSelection(c.tags,c.creator,sources,users,false)).map(c=>c.id);
 expect(select(['yeshiva'],[])).toEqual([1,3]);
 expect(select([],['A'])).toEqual([2,3]);
 expect(select(['yeshiva'],['A'])).toEqual([1,2,3]);
 expect(select([],[])).toEqual([]);
 expect(matchesContentSelection(['source:ai'],'B',null,[],false)).toBe(false);
});
it('preserves none and multiple through profile serialization; matches any selected provenance',()=>{
 for(const sourceTags of [[],['ai','shemesh']])expect(normalizeContentAccessProfile(JSON.parse(JSON.stringify({sourceTags}))).sourceTags).toEqual(sourceTags);
 expect(matchesQuestionSources(['source:ai'],[])).toBe(false);
 expect(matchesQuestionSources(['source:ai'],['ai','shemesh'])).toBe(true);
 expect(matchesQuestionSources(['source:client:desktop'],['unattributed'])).toBe(true);
 expect(matchesQuestionSources(['source:ai'],undefined)).toBe(true);
});
it('filters previously cached library cards on every profile change without deleting them',()=>{
 const cached=[{id:1,tags:['source:shemesh'],creator:'A'},{id:2,tags:['source:yeshiva'],creator:'B'}];
 const visible=(sources:string[]|null,users:string[]=[])=>cached.filter(c=>matchesContentSelection(c.tags,c.creator,sources,users,true)).map(c=>c.id);
 expect(visible(null)).toEqual([1,2]);
 expect(visible(['yeshiva'])).toEqual([2]);
 expect(visible([])).toEqual([]);
 expect(visible(['yeshiva'],['A'])).toEqual([1,2]);
 expect(visible(['shemesh'])).toEqual([1]);
 expect(cached).toHaveLength(2);
});
