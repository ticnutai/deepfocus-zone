import {render,screen,cleanup} from '@testing-library/react';
import {afterEach,expect,it} from 'vitest';
import {QuestionCountBadge} from '@/components/admin/QuestionCountBadge';
afterEach(cleanup);
it.each([0,1,12450])('shows the exact count %i with an accessible label',count=>{
 render(<QuestionCountBadge count={count}/>);
 expect(screen.getByLabelText(`${count.toLocaleString('he-IL')} שאלות`)).toHaveTextContent(count.toLocaleString('he-IL'));
});
it.each([undefined,-1,NaN])('does not claim zero for missing counts',count=>{
 render(<QuestionCountBadge count={count}/>);
 expect(screen.getByLabelText('כמות שאלות לא זמינה')).toHaveTextContent('—');
});
