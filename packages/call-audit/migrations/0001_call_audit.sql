-- One row per capability call: the same five fields as the log line, plus the time it was written.
-- No input and no error message, ever: input is often user data.
create table call_audit (
  id bigint generated always as identity primary key,
  recorded_at timestamptz not null default now(),
  capability text not null,
  permission text not null,
  viewer_id text,
  outcome text not null,
  ms integer not null
);
--> statement-breakpoint
-- The two read patterns of readRows: newest first, and newest first for one viewer.
create index call_audit_recorded_at on call_audit (recorded_at desc, id desc);
--> statement-breakpoint
create index call_audit_viewer_recorded_at on call_audit (viewer_id, recorded_at desc, id desc);
