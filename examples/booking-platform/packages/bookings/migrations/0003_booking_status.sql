-- Every booking existing before this migration was never cancelled, so it starts active.
alter table booking add column status text not null default 'active'
  check (status in ('active', 'cancelled'));
