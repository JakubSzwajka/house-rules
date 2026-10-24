CREATE TABLE push_subscriptions (
  endpoint text PRIMARY KEY,
  owner_kind text NOT NULL,
  owner_id text NOT NULL,
  p256dh text NOT NULL,
  auth text NOT NULL,
  user_agent text,
  created_at bigint NOT NULL,
  expired_at bigint
);
--> statement-breakpoint
CREATE INDEX push_subscriptions_owner ON push_subscriptions (owner_kind, owner_id) WHERE expired_at IS NULL;
