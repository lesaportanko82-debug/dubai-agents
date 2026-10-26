-- Payments with rules + household profile (digital twin)

alter table dm_households add column if not exists wallet jsonb;
alter table dm_outbox add column if not exists payment_id text;

create table if not exists dm_payments (
  id text primary key,
  household_id uuid not null references dm_households(id) on delete cascade,
  requested_by text not null,
  merchant text not null,
  category text not null,
  items text not null,
  amount numeric not null,
  currency text not null,
  amount_in_wallet numeric not null,
  status text not null check (status in ('paid', 'declined', 'pending_approval', 'refunded', 'failed')),
  reason jsonb not null,
  rule text,
  provider_ref text,          -- pi_… (Stripe test) or sim_…; never a card number
  receipt_url text,
  approval_id text,
  override_by text,
  created_at timestamptz not null default now(),
  paid_at timestamptz,
  refunded_at timestamptz,
  task_id text
);
create index if not exists dm_payments_household on dm_payments(household_id, created_at desc);
alter table dm_payments enable row level security;

create table if not exists dm_profile (
  household_id uuid not null references dm_households(id) on delete cascade,
  key text not null,
  kind text not null check (kind in ('place', 'person', 'rule', 'recurring', 'other')),
  value text not null,                 -- sealed (AES-256-GCM, PROFILE_KEY) for medical keys
  sealed boolean not null default false,
  about_member_id text,
  access text not null check (access in ('family', 'adults', 'owner')),
  source text not null check (source in ('stated', 'learned')),
  created_by text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (household_id, key)
);
alter table dm_profile enable row level security;
