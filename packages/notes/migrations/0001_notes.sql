create table notes (
  id text primary key,
  target_kind text not null,
  target_id text not null,
  author_id text not null,
  body text not null,
  created_at bigint not null
);
--> statement-breakpoint
create index notes_target_page on notes (target_kind, target_id, created_at, id collate "C");
--> statement-breakpoint
create index notes_author on notes (author_id);
