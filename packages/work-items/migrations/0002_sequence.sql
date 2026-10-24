create sequence work_items_id_sequence;
--> statement-breakpoint
-- Release the allocation lock inside the call, not at transaction end. Imports and
-- nextval must not race setval backward, but unrelated writes must not wait for commit.
create function work_items_sequence_value(imported bigint) returns bigint
language plpgsql as $$
declare
  allocated bigint;
begin
  perform pg_advisory_lock(1965032441, 1);
  if imported is null then
    allocated := nextval('work_items_id_sequence');
  else
    select setval('work_items_id_sequence', greatest(last_value, imported), true)
      into allocated from work_items_id_sequence;
  end if;
  perform pg_advisory_unlock(1965032441, 1);
  return allocated;
exception when query_canceled or others then
  perform pg_advisory_unlock(1965032441, 1);
  raise;
end;
$$;
--> statement-breakpoint
-- Import inserts in id order, including batches where children precede parents.
alter table work_items alter constraint work_items_parent_fkey deferrable initially deferred;
