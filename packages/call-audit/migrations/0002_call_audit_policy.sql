-- What the policy needs: the object touched, where the call came from, the request it belongs to,
-- and whether it read or wrote. All nullable, so rows written before this migration stay as they are.
alter table call_audit
  add column kind text,
  add column target_id text,
  add column channel text,
  add column request_id text;
--> statement-breakpoint
alter table call_audit
  add constraint call_audit_kind check (kind is null or kind in ('read', 'write'));
--> statement-breakpoint
-- Retention deletes one class at a time, oldest first: outcome and kind pick the class.
-- Erasure by viewer uses call_audit_viewer_recorded_at from 0001.
create index call_audit_retention on call_audit (outcome, kind, recorded_at, id);
