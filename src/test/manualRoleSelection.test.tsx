import {render,screen,fireEvent,waitFor,cleanup,act} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
const mock=vi.hoisted(()=>({rpc:vi.fn(),from:vi.fn(),base:true,roles:['narrow']}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{rpc:mock.rpc,from:mock.from}}));
vi.mock('@/hooks/useAuth',()=>({useAuth:()=>({user:{id:'admin'}})}));
vi.mock('@/lib/auth/localAccount',()=>({syntheticEmailForUsername:(s:string)=>s+'@example.invalid'}));
import {UsersTab} from '@/components/admin/UsersTab';
const roles=[{id:'registered',name:'משתמש רשום',access_kind:'registered'},
 {id:'narrow',name:'אופלי',access_kind:null},{id:'wide',name:'מורחב',access_kind:null}];
beforeEach(()=>{
 mock.base=true;mock.roles=['narrow'];
 Element.prototype.hasPointerCapture=()=>false;
 Element.prototype.setPointerCapture=()=>{};
 Element.prototype.releasePointerCapture=()=>{};
 Element.prototype.scrollIntoView=()=>{};
 mock.from.mockImplementation((table:string)=>{
  const data=()=>table==='profiles'?[{id:'user',display_name:'בדיקה',email:'qa@example.invalid',status:'approved',created_at:'2026-09-15',role_baseline_enabled:mock.base}]
   :table==='app_roles'?roles:table==='user_roles'?mock.roles.map(role_id=>({user_id:'user',role_id})):[];
  const chain:any={select:()=>chain,order:()=>chain,then:(resolve:any)=>Promise.resolve({data:data()}).then(resolve),
   upsert:(row:any)=>{mock.roles.push(row.role_id);return Promise.resolve({error:null});}};
  return chain;
 });
 mock.rpc.mockImplementation(async(_name,args)=>{mock.roles=[args.p_role_id];mock.base=args.p_role_id==='registered';return {error:null};});
});
afterEach(()=>{cleanup();vi.clearAllMocks();});
async function choose(label:string,name:string){
 fireEvent.keyDown(screen.getByText(label).closest('button')!,{key:'ArrowDown'});
 const option=await screen.findByRole('option',{name});
 await act(async()=>{fireEvent.click(option);});
}
it('keeps existing roles until a manual replacement, then adds separately and restores the default',async()=>{
 render(<UsersTab/>);
 await screen.findByText('qa@example.invalid');
 expect(screen.getByText('משתמש רשום')).toBeInTheDocument();
 expect(screen.getByText('אופלי')).toBeInTheDocument();
 await choose('החלף תפקיד','אופלי');
 await waitFor(()=>expect(screen.queryByText('משתמש רשום')).not.toBeInTheDocument());
 expect(mock.rpc).toHaveBeenCalledWith('admin_replace_user_role',{p_user_id:'user',p_role_id:'narrow'});
 await choose('הוסף תפקיד','מורחב');
 await waitFor(()=>expect(mock.roles).toEqual(['narrow','wide']));
 expect(mock.base).toBe(false);
 await choose('החלף תפקיד','משתמש רשום');
 await waitFor(()=>expect(mock.roles).toEqual(['registered']));
 expect(mock.base).toBe(true);
});
