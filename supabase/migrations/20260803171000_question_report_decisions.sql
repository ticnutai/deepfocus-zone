-- Structured moderation decisions for question/answer reports.
alter table public.source_change_notes
  add column if not exists target_kind text,
  add column if not exists target_text text,
  add column if not exists target_index integer,
  add column if not exists reviewed_at timestamptz,
  add column if not exists reviewed_by uuid references auth.users(id) on delete set null,
  add column if not exists admin_response text;

create index if not exists idx_scn_status_created
  on public.source_change_notes(status, created_at desc);

comment on column public.source_change_notes.status is
  'open=pending admin decision, accepted=accepted by admin, rejected=rejected by admin';
