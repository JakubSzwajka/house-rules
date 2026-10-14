create table identity_binding (
  issuer text not null,
  subject text not null,
  actor_id text not null,
  created_at timestamptz not null default now(),
  primary key (issuer, subject)
);
--> statement-breakpoint
create index identity_binding_actor on identity_binding (actor_id);
