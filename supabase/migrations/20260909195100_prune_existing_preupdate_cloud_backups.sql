-- One-time normalization for backups created before rotating retention existed.
-- Keep the newest two pre-update backups for every user; chunk rows follow the
-- existing ON DELETE CASCADE foreign key.
with ranked as (
  select
    id,
    row_number() over (
      partition by user_id
      order by created_at desc, id desc
    ) as position
  from public.user_backups
  where topic_ids @> array['system:pre-update']::text[]
     or name like 'גיבוי אוטומטי לפני עדכון%'
)
delete from public.user_backups as backup
using ranked
where backup.id = ranked.id
  and ranked.position > 2;
