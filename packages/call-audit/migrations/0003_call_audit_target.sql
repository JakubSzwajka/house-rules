alter table call_audit add column target text;
--> statement-breakpoint
update call_audit set target = capability where target is null;
--> statement-breakpoint
alter table call_audit alter column target set not null;
