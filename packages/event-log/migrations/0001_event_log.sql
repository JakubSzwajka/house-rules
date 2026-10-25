CREATE TABLE event_log_sequence (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  cursor bigint NOT NULL DEFAULT 0
);
--> statement-breakpoint
INSERT INTO event_log_sequence (singleton) VALUES (true);
--> statement-breakpoint
CREATE TABLE event_log_events (
  id bigint PRIMARY KEY,
  kind text NOT NULL,
  subject_kind text NOT NULL,
  subject_id text NOT NULL,
  payload jsonb NOT NULL,
  scope_id text,
  actor_id text,
  occurred_at bigint NOT NULL,
  request_id text
);
--> statement-breakpoint
CREATE INDEX event_log_events_kind_cursor ON event_log_events (kind, id);
--> statement-breakpoint
CREATE TABLE event_log_consumers (
  name text PRIMARY KEY,
  cursor bigint NOT NULL DEFAULT 0
);
--> statement-breakpoint
CREATE TABLE event_log_pending (
  consumer text NOT NULL REFERENCES event_log_consumers (name),
  event_id bigint NOT NULL REFERENCES event_log_events (id),
  attempts integer NOT NULL CHECK (attempts >= 0),
  next_due bigint NOT NULL,
  replay boolean NOT NULL,
  generation text NOT NULL,
  last_error text NOT NULL,
  PRIMARY KEY (consumer, event_id)
);
--> statement-breakpoint
CREATE INDEX event_log_pending_replay_cursor ON event_log_pending (consumer, event_id) WHERE replay = true;
--> statement-breakpoint
CREATE TABLE event_log_dead_letters (
  consumer text NOT NULL REFERENCES event_log_consumers (name),
  event_id bigint NOT NULL REFERENCES event_log_events (id),
  last_error text NOT NULL,
  attempts integer NOT NULL CHECK (attempts > 0),
  failed_at bigint NOT NULL,
  PRIMARY KEY (consumer, event_id)
);
--> statement-breakpoint
CREATE VIEW event_log_history AS SELECT id, kind, subject_kind, subject_id, payload, scope_id, actor_id, occurred_at, request_id FROM event_log_events;
