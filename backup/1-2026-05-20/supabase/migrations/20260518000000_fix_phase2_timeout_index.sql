-- Fix Phase 2 statement timeout and add index for get_unreviewed_cards_page
--
-- WHY: With 26,696 cards, the function times out at 15s because:
--  1. No composite index on (user_id, created_at) → full scan on each page
--  2. 8 concurrent requests each do a full scan → DB overload
-- FIX: add index + increase timeout to 60s

-- Index to speed up the WHERE user_id + ORDER BY created_at
CREATE INDEX IF NOT EXISTS idx_cards_user_created
  ON public.cards(user_id, created_at);

-- Rebuild the function with 60s timeout
create or replace function public.get_unreviewed_cards_page(p_offset int default 0, p_limit int default 500)
returns jsonb
language sql
security definer
set search_path = public
set statement_timeout = '60s'
as $$
  select coalesce(
    jsonb_agg(to_jsonb(c)),
    '[]'::jsonb
  )
  from (
    select *
    from public.cards c
    where c.user_id = auth.uid()
      AND (
        c.srs IS NULL
        OR c.srs->>'lastReviewedAt' IS NULL
        OR c.srs->>'lastReviewedAt' = 'null'
      )
    order by c.created_at
    limit p_limit
    offset p_offset
  ) c;
$$;

grant execute on function public.get_unreviewed_cards_page(int, int) to authenticated;
