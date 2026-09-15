import {fireEvent,render,screen,waitFor} from '@testing-library/react';
import {expect,it,vi} from 'vitest';
const {load}=vi.hoisted(()=>({load:vi.fn()}));
vi.mock('@/lib/study/adminSourceCatalog',()=>({loadAdminSourceCatalog:load,sourceCatalogError:()=> 'הספירה ארכה יותר מדי זמן',invalidateAdminSourceCatalog:vi.fn()}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{rpc:vi.fn()}}));
import {SourceApprovalsTab} from '@/components/admin/SourceApprovalsTab';
it('retains displayed sources after failed refresh and supports retry',async()=>{
 load.mockResolvedValueOnce([{source_id:'yeshiva',question_count:3518,approved_count:0,pending_count:3518,hidden_count:0,auto_approve:false}]);
 render(<SourceApprovalsTab/>);await screen.findByText('מאגר הישיבה');
 load.mockRejectedValueOnce({code:'57014'});fireEvent.click(screen.getByText('רענן מקורות'));
 await screen.findByRole('alert');expect(screen.getByText('מאגר הישיבה')).toBeInTheDocument();
 load.mockResolvedValueOnce([]);fireEvent.click(screen.getByText('רענן מקורות'));
 await waitFor(()=>expect(screen.queryByRole('alert')).not.toBeInTheDocument());expect(await screen.findByText('לא נמצאו מקורות תואמים.')).toBeInTheDocument();
});
