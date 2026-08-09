-- Approve several user questions in one database transaction. If any question
-- fails, none of the selected questions are published partially.
create or replace function public.publish_user_questions(p_card_ids uuid[])
returns table(original_card_id uuid, published_card_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_card_id uuid;
  v_published_id uuid;
begin
  if auth.uid() is null or not public.is_admin(auth.uid()) then
    raise exception 'admin access required' using errcode = '42501';
  end if;
  if coalesce(array_length(p_card_ids, 1), 0) < 1 then
    raise exception 'at least one question is required';
  end if;
  if array_length(p_card_ids, 1) > 500 then
    raise exception 'a maximum of 500 questions can be approved at once';
  end if;

  foreach v_card_id in array p_card_ids loop
    v_published_id := public.publish_user_question(v_card_id);
    original_card_id := v_card_id;
    published_card_id := v_published_id;
    return next;
  end loop;
end;
$$;

revoke all on function public.publish_user_questions(uuid[]) from public;
grant execute on function public.publish_user_questions(uuid[]) to authenticated;
