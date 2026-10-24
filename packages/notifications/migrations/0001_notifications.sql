CREATE TABLE notifications (
  id text PRIMARY KEY,
  recipient_kind text NOT NULL,
  recipient_id text NOT NULL,
  category text NOT NULL,
  title text NOT NULL,
  body text NOT NULL,
  data jsonb NOT NULL,
  created_at bigint NOT NULL,
  read_at bigint,
  UNIQUE (id, recipient_kind, recipient_id)
);
--> statement-breakpoint
CREATE INDEX notifications_inbox ON notifications (recipient_kind, recipient_id, created_at DESC, id COLLATE "C" DESC);
--> statement-breakpoint
CREATE TABLE notification_preferences (
  recipient_kind text NOT NULL,
  recipient_id text NOT NULL,
  category text NOT NULL,
  channel text NOT NULL CHECK (channel IN ('inapp', 'push', 'email')),
  mode text NOT NULL CHECK (mode IN ('immediate', 'hourly', 'daily', 'off')),
  PRIMARY KEY (recipient_kind, recipient_id, category, channel)
);
--> statement-breakpoint
CREATE TABLE notification_quiet_hours (
  recipient_kind text NOT NULL,
  recipient_id text NOT NULL,
  start_time text NOT NULL,
  end_time text NOT NULL,
  PRIMARY KEY (recipient_kind, recipient_id)
);
--> statement-breakpoint
CREATE TABLE notification_time_zones (
  recipient_kind text NOT NULL,
  recipient_id text NOT NULL,
  time_zone text NOT NULL,
  PRIMARY KEY (recipient_kind, recipient_id)
);
--> statement-breakpoint
CREATE TABLE notification_deliveries (
  id text PRIMARY KEY,
  notification_id text NOT NULL,
  recipient_kind text NOT NULL,
  recipient_id text NOT NULL,
  channel text NOT NULL CHECK (channel IN ('inapp', 'push', 'email')),
  mode text NOT NULL CHECK (mode IN ('immediate', 'hourly', 'daily')),
  state text NOT NULL CHECK (state IN ('pending', 'held', 'sent', 'failed', 'cancelled')),
  due_at bigint NOT NULL,
  retry_at bigint,
  sent_at bigint,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  last_error text,
  UNIQUE (notification_id, channel, recipient_kind, recipient_id),
  FOREIGN KEY (notification_id, recipient_kind, recipient_id) REFERENCES notifications (id, recipient_kind, recipient_id) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX notification_deliveries_due ON notification_deliveries (due_at, id COLLATE "C") WHERE state IN ('pending', 'held');
--> statement-breakpoint
CREATE INDEX notification_deliveries_unsettled ON notification_deliveries (recipient_kind, recipient_id, id COLLATE "C") WHERE state IN ('pending', 'held');
--> statement-breakpoint
CREATE VIEW notifications_published AS SELECT id, recipient_kind, recipient_id, category, title, body, data, created_at, read_at FROM notifications;
