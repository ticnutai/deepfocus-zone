import {fireEvent,render,screen,waitFor} from '@testing-library/react';
import {beforeEach,expect,it,vi} from 'vitest';
import {SourceApprovalControls} from '@/components/admin/SourceApprovalControls';
const {rpc}=vi.hoisted(()=>({rpc:vi.fn()}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{rpc}}));
vi.mock('sonner',()=>({toast:{success:vi.fn(),error:vi.fn()}}));
const stats={approved_count:5,pending_count:10,hidden_count:2,auto_approve:false};
beforeEach(()=>rpc.mockReset().mockResolvedValueOnce({data:10,error:null}).mockResolvedValue({data:0,error:null}));
it('requires explicit confirmation and refreshes after source approval',async()=>{
 const refresh=vi.fn().mockResolvedValue(undefined);
 render(<SourceApprovalControls id="yeshiva" stats={stats} onRefresh={refresh}/>);
 fireEvent.click(screen.getByText('אשר את כל הממתינות'));
 expect(rpc).not.toHaveBeenCalled();
 expect(screen.getByText(/האישור חל בכל הפרופילים/)).toBeInTheDocument();
 fireEvent.click(screen.getByText('אישור הפעולה'));
 await waitFor(()=>expect(refresh).toHaveBeenCalledOnce());
 expect(rpc).toHaveBeenCalledWith('admin_approve_question_source',{p_source_id:'yeshiva'});
});
it('cancellation does not approve and zero pending disables bulk action',()=>{
 const view=render(<SourceApprovalControls id="yeshiva" stats={stats} onRefresh={async()=>{}}/>);
 fireEvent.click(screen.getByText('אשר את כל הממתינות'));fireEvent.click(screen.getByText('סגור'));
 expect(rpc).not.toHaveBeenCalled();
 view.rerender(<SourceApprovalControls id="yeshiva" stats={{...stats,pending_count:0}} onRefresh={async()=>{}}/>);
 expect(screen.getByText('אשר את כל הממתינות')).toBeDisabled();
});
it('auto approval is opt-in and confirmation sends the source setting',async()=>{
 render(<SourceApprovalControls id="yeshiva" stats={stats} onRefresh={async()=>{}}/>);
 fireEvent.click(screen.getByText(/אישור אוטומטי בייבוא מנהל/));
 expect(rpc).not.toHaveBeenCalled();fireEvent.click(screen.getByText('אישור הפעולה'));
 await waitFor(()=>expect(rpc).toHaveBeenCalledWith('admin_set_source_auto_approval',{p_source_id:'yeshiva',p_enabled:true}));
});
