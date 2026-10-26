-- Shopping carts the agent prepares (level-1 merchant integration: deep link + one-tap human checkout)
create table if not exists dm_carts (
  id text primary key,
  household_id uuid not null references dm_households(id) on delete cascade,
  status text not null check (status in ('sent', 'paid_by_human', 'paid_by_wallet', 'delivered', 'cancelled')),
  created_at timestamptz not null default now(),
  data jsonb not null
);
create index if not exists dm_carts_household on dm_carts(household_id, created_at desc);
alter table dm_carts enable row level security;
alter table dm_outbox add column if not exists cart_id text;

-- one shared demo household; concurrent first requests must not create two
create unique index if not exists dm_households_demo_unique on dm_households (name) where name = 'Demo · Домовёнок';
