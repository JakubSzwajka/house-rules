create table comments (
  id text primary key,
  target_kind text not null,
  target_id text not null,
  author_id text not null,
  body text not null,
  created_at bigint not null,
  edited_at bigint
);
--> statement-breakpoint
create index comments_target_page on comments (target_kind, target_id, created_at, id collate "C");
--> statement-breakpoint
create index comments_author on comments (author_id);
