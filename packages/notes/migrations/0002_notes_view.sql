create view notes_view as
select id, target_kind, target_id, author_id, body, created_at
from notes;
