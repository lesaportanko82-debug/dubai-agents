-- Closing the loop (2026-10-27): human checkpoints, autonomous actions, verification, visible learning.

-- 1. dm_approvals — decisions the agent asks a person for (or reports after acting)
create table if not exists dm_approvals (
  id text primary key,
  household_id uuid not null references dm_households(id) on delete cascade,
  action text not null check (action in (
    'reschedule_task', 'create_task', 'cancel_task', 'spend_money', 'change_child_schedule', 'share_outside'
  )),
  requested_by text not null,              -- member id or 'agent'
  approver_ids text[] not null default '{}',
  payload jsonb not null default '{}',     -- action arguments; payload.onReject = fallback action
  reason jsonb not null,                   -- { ru, en }
  fallback jsonb,                          -- { ru, en } — what happens on "no"
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'expired', 'executed', 'failed')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  decided_at timestamptz,
  decided_by text,
  result jsonb
);
create index if not exists dm_approvals_pending on dm_approvals(household_id, expires_at) where status = 'pending';
create index if not exists dm_approvals_household on dm_approvals(household_id, created_at desc);
alter table dm_approvals enable row level security;

-- 2. outbox messages may carry the approval their buttons decide
alter table dm_outbox add column if not exists approval_id text;

-- 3. insight types: the original check list lacked weather_alert (inserts were failing quietly) + the new loop kinds
do $$
begin
  if exists (select 1 from pg_constraint where conname = 'dm_insights_insight_type_check') then
    alter table dm_insights drop constraint dm_insights_insight_type_check;
  end if;
end $$;
alter table dm_insights add constraint dm_insights_insight_type_check check (insight_type in (
  'morning_briefing', 'rebalance_suggestion', 'conflict_warning', 'pattern_prediction', 'streak_alert', 'idle_member', 'overload_warning', 'weekly_digest',
  'weather_alert', 'weather_conflict', 'recurring_prediction', 'loop_closed'
));
