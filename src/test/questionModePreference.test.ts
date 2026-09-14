import {describe,it,expect} from 'vitest';
import {resolveQuestionMode,matchesQuestionMode} from '@/lib/study/questionModePreference';
describe('question mode preference',()=>{
 it('defaults to multiple choice without writing over saved choices',()=>{
  expect(resolveQuestionMode(undefined,null)).toBe('multi');
  expect(resolveQuestionMode('both','multi')).toBe('both');
  expect(resolveQuestionMode(undefined,'flash')).toBe('flash');
 });
 it('filters multiple choice including combined questions but not boolean or flash cards',()=>{
  expect(matchesQuestionMode({type:'multiple'},'multi')).toBe(true);
  expect(matchesQuestionMode({type:'combo',options:['one']},'multi')).toBe(true);
  expect(matchesQuestionMode({type:'boolean'},'multi')).toBe(false);
  expect(matchesQuestionMode({type:'flashcard'},'multi')).toBe(false);
  expect(matchesQuestionMode({type:'flashcard'},'both')).toBe(true);
 });
});
