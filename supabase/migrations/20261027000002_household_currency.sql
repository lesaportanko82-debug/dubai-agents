-- Multi-currency money checkpoint: each household has its own currency and approval threshold.
alter table dm_households add column if not exists currency text not null default 'AED';
alter table dm_households add column if not exists money_threshold int not null default 200;
