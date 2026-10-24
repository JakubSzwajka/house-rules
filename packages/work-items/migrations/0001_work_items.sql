CREATE TABLE work_items (
  id text PRIMARY KEY,
  title text NOT NULL,
  body text NOT NULL,
  status text NOT NULL,
  holder_kind text,
  holder_id text,
  parent text REFERENCES work_items(id) ON DELETE CASCADE,
  container_kind text,
  container_id text,
  attributes jsonb NOT NULL,
  created_at bigint NOT NULL,
  updated_at bigint NOT NULL,
  closed_at bigint,
  CHECK ((holder_kind IS NULL) = (holder_id IS NULL)),
  CHECK ((container_kind IS NULL) = (container_id IS NULL))
);
--> statement-breakpoint
CREATE INDEX work_items_container_page ON work_items (container_kind, container_id, created_at, id COLLATE "C");
--> statement-breakpoint
CREATE INDEX work_items_parent ON work_items (parent);
--> statement-breakpoint
CREATE INDEX work_items_holder ON work_items (holder_kind, holder_id);
--> statement-breakpoint
CREATE VIEW work_items_view AS SELECT id, title, body, status, holder_kind, holder_id, parent, container_kind, container_id, attributes, created_at, updated_at, closed_at FROM work_items;
