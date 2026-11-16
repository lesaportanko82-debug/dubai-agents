-- OWED · SQPM document store: one row per entity (supplier, contract, batch, delivery, order, case, claim, settings, audit).
-- Server-only (service role); RLS on with no policies = no anonymous access.
create table if not exists public.owed_docs (
  kind text not null,
  id text not null,
  data jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (kind, id)
);
create index if not exists owed_docs_kind_idx on public.owed_docs (kind);
alter table public.owed_docs enable row level security;
