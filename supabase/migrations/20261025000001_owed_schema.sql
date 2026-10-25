-- OWED: warranty-cost recovery agent — core schema
-- Multi-tenant: every business row belongs to an organization (org_id).
-- Access: users see only their org's rows (RLS). The agent runs with the service role.

create extension if not exists "pgcrypto";

-- ---------- tenancy ----------
create table public.organizations (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  base_currency text not null default 'USD',
  created_at  timestamptz not null default now()
);

create type public.member_role as enum ('owner', 'quality', 'procurement', 'service', 'viewer');

create table public.org_members (
  org_id   uuid not null references public.organizations(id) on delete cascade,
  user_id  uuid not null references auth.users(id) on delete cascade,
  role     public.member_role not null default 'viewer',
  primary key (org_id, user_id)
);

create or replace function public.is_member(p_org uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from org_members where org_id = p_org and user_id = auth.uid());
$$;

create or replace function public.has_role(p_org uuid, p_roles public.member_role[])
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from org_members where org_id = p_org and user_id = auth.uid() and role = any(p_roles));
$$;

-- ---------- master data ----------
create table public.suppliers (
  id                 uuid primary key default gen_random_uuid(),
  org_id             uuid not null references public.organizations(id) on delete cascade,
  code               text not null,                -- e.g. F-A
  name               text not null,
  country            text not null default 'China',
  contact_lang       text not null default 'zh',   -- zh | en
  warranty_months    int  not null default 12,
  allowed_defect_pct numeric(5,2) not null default 1.0,
  currency           text not null default 'USD',
  created_at         timestamptz not null default now(),
  unique (org_id, code)
);

create table public.batches (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.organizations(id) on delete cascade,
  code         text not null,                 -- e.g. B-2026-058
  supplier_id  uuid not null references public.suppliers(id),
  sku          text not null,
  container    text,
  serial_from  bigint,
  serial_to    bigint,
  shipped_at   date not null,
  qty          int  not null check (qty > 0),
  unit_cost    numeric(12,2) not null,        -- commercial: restricted columns via view below
  created_at   timestamptz not null default now(),
  unique (org_id, code),
  check (serial_from is null or serial_to is null or serial_from <= serial_to)
);
create index batches_sku_idx on public.batches (org_id, sku, shipped_at desc);

-- ---------- defect cases ----------
create type public.defect_class as enum ('manufacturing', 'transport', 'installation', 'unknown');
create type public.case_status as enum ('new', 'needs_review', 'evidenced', 'claimed', 'offered', 'recovered', 'written_off', 'not_recoverable');
create type public.attribution_method as enum ('serial', 'sku_single_batch', 'sku_latest_batch_guess', 'none', 'manual');

create table public.defect_cases (
  id                 uuid primary key default gen_random_uuid(),
  org_id             uuid not null references public.organizations(id) on delete cascade,
  external_ref       text,                      -- ticket / act number; NO customer PII
  channel            text not null,             -- telegram | email | service_act | marketplace | test
  received_at        timestamptz not null default now(),
  sku                text,
  serial             bigint,
  batch_id           uuid references public.batches(id),
  supplier_id        uuid references public.suppliers(id),
  attribution        public.attribution_method not null default 'none',
  description        text not null,             -- redacted, English
  defect_class       public.defect_class not null default 'unknown',
  confidence         numeric(4,3) check (confidence between 0 and 1),
  reasoning          text,
  part_cost          numeric(12,2) not null default 0,
  labour_cost        numeric(12,2) not null default 0,
  logistics_cost     numeric(12,2) not null default 0,
  compensation_cost  numeric(12,2) not null default 0,
  total_cost         numeric(12,2) generated always as (part_cost + labour_cost + logistics_cost + compensation_cost) stored,
  recoverable        boolean not null default false,
  needs_review       boolean not null default false,
  status             public.case_status not null default 'new',
  photo_paths        text[] not null default '{}',   -- Supabase Storage paths
  created_at         timestamptz not null default now(),
  unique (org_id, channel, external_ref)
);
create index defect_cases_supplier_idx on public.defect_cases (org_id, supplier_id, status);
create index defect_cases_batch_idx on public.defect_cases (org_id, batch_id);

-- ---------- negotiation packs ----------
create type public.pack_status as enum ('draft', 'approved', 'sent', 'accepted', 'partially_accepted', 'rejected');

create table public.negotiation_packs (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.organizations(id) on delete cascade,
  supplier_id   uuid not null references public.suppliers(id),
  period_from   date not null,
  period_to     date not null,
  case_ids      uuid[] not null,
  amount        numeric(12,2) not null,
  options       jsonb not null default '[]',     -- compensation options
  contract_clauses jsonb not null default '[]',
  text_en       text,
  text_zh       text,
  status        public.pack_status not null default 'draft',
  approved_by   uuid references auth.users(id),
  approved_at   timestamptz,
  outcome_amount numeric(12,2),
  outcome_form   text,                          -- credit_note | free_parts | warranty_extension | cash
  created_at    timestamptz not null default now()
);

-- ---------- audit log (append-only) ----------
create table public.audit_log (
  id        bigint generated always as identity primary key,
  org_id    uuid not null references public.organizations(id) on delete cascade,
  actor     text not null,                -- 'agent' or auth user id
  action    text not null,                -- e.g. case.saved, pack.approved
  entity    text not null,
  entity_id uuid,
  details   jsonb not null default '{}',
  at        timestamptz not null default now()
);
create index audit_log_org_idx on public.audit_log (org_id, at desc);

-- ---------- recovery ledger (per supplier) ----------
create or replace view public.recovery_ledger with (security_invoker = true) as
select
  c.org_id,
  c.supplier_id,
  s.code as supplier_code,
  s.name as supplier_name,
  count(*) filter (where c.recoverable)                                         as recoverable_cases,
  coalesce(sum(c.total_cost) filter (where c.recoverable and c.status in ('evidenced','claimed','offered')), 0) as open_amount,
  coalesce(sum(c.total_cost) filter (where c.status = 'needs_review'), 0)        as pending_review_amount,
  coalesce(sum(c.total_cost) filter (where c.status = 'recovered'), 0)           as recovered_amount
from public.defect_cases c
join public.suppliers s on s.id = c.supplier_id
group by c.org_id, c.supplier_id, s.code, s.name;

-- ---------- defect rate per batch (spike detection input) ----------
create or replace view public.batch_defect_rates with (security_invoker = true) as
select
  b.org_id, b.id as batch_id, b.code as batch_code, b.sku, b.supplier_id, b.qty, b.shipped_at,
  count(c.id) filter (where c.defect_class = 'manufacturing') as manufacturing_cases,
  round(100.0 * count(c.id) filter (where c.defect_class = 'manufacturing') / b.qty, 3) as defect_pct
from public.batches b
left join public.defect_cases c on c.batch_id = b.id
group by b.org_id, b.id, b.code, b.sku, b.supplier_id, b.qty, b.shipped_at;

-- ---------- RLS ----------
alter table public.organizations     enable row level security;
alter table public.org_members       enable row level security;
alter table public.suppliers         enable row level security;
alter table public.batches           enable row level security;
alter table public.defect_cases      enable row level security;
alter table public.negotiation_packs enable row level security;
alter table public.audit_log         enable row level security;

create policy org_read on public.organizations for select using (public.is_member(id));
create policy members_read on public.org_members for select using (public.is_member(org_id));

create policy suppliers_read on public.suppliers for select using (public.is_member(org_id));
create policy suppliers_write on public.suppliers for all
  using (public.has_role(org_id, array['owner','procurement']::public.member_role[]))
  with check (public.has_role(org_id, array['owner','procurement']::public.member_role[]));

-- batches contain purchase prices: only owner / procurement / quality may read them
create policy batches_read on public.batches for select
  using (public.has_role(org_id, array['owner','procurement','quality']::public.member_role[]));
create policy batches_write on public.batches for all
  using (public.has_role(org_id, array['owner','procurement']::public.member_role[]))
  with check (public.has_role(org_id, array['owner','procurement']::public.member_role[]));

create policy cases_read on public.defect_cases for select using (public.is_member(org_id));
create policy cases_update on public.defect_cases for update
  using (public.has_role(org_id, array['owner','quality','service']::public.member_role[]))
  with check (public.has_role(org_id, array['owner','quality','service']::public.member_role[]));

create policy packs_read on public.negotiation_packs for select
  using (public.has_role(org_id, array['owner','procurement','quality']::public.member_role[]));
create policy packs_approve on public.negotiation_packs for update
  using (public.has_role(org_id, array['owner','procurement']::public.member_role[]))
  with check (public.has_role(org_id, array['owner','procurement']::public.member_role[]));

create policy audit_read on public.audit_log for select
  using (public.has_role(org_id, array['owner']::public.member_role[]));
-- No insert/update/delete policies on audit_log for users: only the service role writes it.
