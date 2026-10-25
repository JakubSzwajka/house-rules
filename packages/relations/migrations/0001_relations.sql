CREATE TABLE relation_edges (
  id text PRIMARY KEY,
  type text NOT NULL,
  source_kind text NOT NULL,
  source_id text NOT NULL,
  target_kind text NOT NULL,
  target_id text NOT NULL,
  created_at bigint NOT NULL
);
--> statement-breakpoint
CREATE INDEX relation_edges_source ON relation_edges (type, source_kind, source_id);
--> statement-breakpoint
CREATE INDEX relation_edges_target ON relation_edges (type, target_kind, target_id);
--> statement-breakpoint
CREATE INDEX relation_edges_source_page ON relation_edges (source_kind, source_id, created_at, id COLLATE "C");
--> statement-breakpoint
CREATE INDEX relation_edges_target_page ON relation_edges (target_kind, target_id, created_at, id COLLATE "C");
