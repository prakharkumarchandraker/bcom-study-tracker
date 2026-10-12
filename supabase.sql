-- Run this once in Supabase: Project -> SQL Editor -> New query -> paste -> Run
create table if not exists public.study_state (
  id text primary key,
  data jsonb not null,
  updated_at timestamptz not null default now()
);
alter table public.study_state enable row level security;
-- The app only reads/writes the row whose id is the secret sync code.
create policy "sync by code" on public.study_state
  for all to anon using (true) with check (true);
