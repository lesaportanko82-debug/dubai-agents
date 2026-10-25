-- Agent Architecture Upgrade: 4 Pillars (2026-10-26)
-- New tables for Memory & Learning, Multi-step Reasoning, Tool Use, Autonomous Loops

-- 1. dm_patterns — behavioral pattern tracking (Memory & Learning)
create table if not exists dm_patterns (
  id bigserial primary key,
  household_id uuid not null references dm_households(id) on delete cascade,
  member_id text not null,
  pattern_type text not null check (pattern_type in (
    'decline_time',       -- declines tasks at certain hours
    'decline_skill',      -- declines tasks requiring certain skills
    'preferred_time',     -- completes tasks faster at certain hours
    'recurring_task',     -- frequently created tasks (weekly grocery, daily walk)
    'response_speed',     -- avg response time to assignment
    'completion_rate',    -- % done vs declined over time
    'pair_affinity',      -- works well with specific member (fast accept, no conflicts)
    'pair_conflict'       -- frequent mutual declines or swaps
  )),
  data jsonb not null default '{}',  -- pattern-specific payload
  confidence real not null default 0.5 check (confidence >= 0 and confidence <= 1),
  observed_count int not null default 1,
  first_seen timestamptz not null default now(),
  last_seen timestamptz not null default now(),
  active boolean not null default true
);
create index if not exists dm_patterns_household on dm_patterns(household_id, member_id);
create index if not exists dm_patterns_type on dm_patterns(household_id, pattern_type);

-- 2. dm_agent_plans — multi-step reasoning plans
create table if not exists dm_agent_plans (
  id text primary key,
  household_id uuid not null references dm_households(id) on delete cascade,
  trigger_text text not null,        -- original user message that spawned the plan
  author_id text not null,
  steps jsonb not null default '[]', -- array of { step, tool, args, status, result }
  status text not null default 'planning' check (status in ('planning', 'executing', 'completed', 'failed', 'cancelled')),
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  data jsonb not null default '{}'   -- extra context, reasoning notes
);
create index if not exists dm_plans_household on dm_agent_plans(household_id, status);

-- 3. dm_reminders — scheduled reminders / alarms (Tool Use)
create table if not exists dm_reminders (
  id text primary key,
  household_id uuid not null references dm_households(id) on delete cascade,
  member_id text not null,
  text text not null,
  remind_at timestamptz not null,
  recurring text check (recurring in ('daily', 'weekly', 'monthly')),
  status text not null default 'pending' check (status in ('pending', 'sent', 'cancelled')),
  created_at timestamptz not null default now(),
  task_id text  -- optional link to a task
);
create index if not exists dm_reminders_due on dm_reminders(remind_at) where status = 'pending';
create index if not exists dm_reminders_household on dm_reminders(household_id);

-- 4. dm_insights — autonomous observations & proactive actions
create table if not exists dm_insights (
  id bigserial primary key,
  household_id uuid not null references dm_households(id) on delete cascade,
  insight_type text not null check (insight_type in (
    'morning_briefing',     -- daily summary for each member
    'rebalance_suggestion', -- workload is unfair, suggest redistribution
    'conflict_warning',     -- detected tension between members
    'pattern_prediction',   -- predicted upcoming need based on patterns
    'streak_alert',         -- member's streak is at risk
    'idle_member',          -- member hasn't been assigned tasks in a while
    'overload_warning',     -- member consistently at daily limit
    'weekly_digest'         -- end-of-week summary with insights
  )),
  target_member_id text,   -- who this insight is about (null = whole household)
  data jsonb not null default '{}',
  delivered boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists dm_insights_household on dm_insights(household_id, created_at desc);
create index if not exists dm_insights_pending on dm_insights(household_id) where delivered = false;

-- RLS: same pattern — on with no policies, server uses service_role key
alter table dm_patterns enable row level security;
alter table dm_agent_plans enable row level security;
alter table dm_reminders enable row level security;
alter table dm_insights enable row level security;
