alter table party_person
  add column kind text not null default 'person' check (kind in ('person', 'agent')),
  add column handle text,
  add column created_by text,
  add column disabled_at timestamptz;
--> statement-breakpoint
update party_person set handle = id;
--> statement-breakpoint
alter table party_person alter column handle set not null;
--> statement-breakpoint
alter table party_person add constraint party_person_handle_unique unique (handle);
--> statement-breakpoint
create view party_principals_read as
select id, display_name, kind, handle, created_by, created_at, disabled_at
from party_person;
--> statement-breakpoint
create view party_assignments_read as
select person_id, role_key, organisation_id from party_assignment;
