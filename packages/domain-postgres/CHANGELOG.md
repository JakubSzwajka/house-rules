# Changelog

## 0.2.0

This release follows 0.1.1. It ports [3in1#79](https://github.com/JakubSzwajka/3in1/pull/79) and earlier changes made in 3in1's copy of this package.

- Commit a view delivery's outbox deletion in the same transaction as its snapshot, emitted entries and downstream deliveries, including duplicates a checkpoint rejects. One WAL flush per view delivery instead of two. Notify subscribers after commit. Policy acknowledgement is unchanged.
- `fromEnv` with `DOMAIN_STORE=memory` wraps `Domain.InMemory` so a scheduled command that wakes early sleeps again until its deadline. Alchemy beta.85 checks the deadline once after its sleep, so an early timer wake lost the command.
- Keep the outbox worker running after SQL failures and defects. Log failures and retry with capped exponential backoff and jitter. Commit kicks do not skip retry delays.
- Do not count SQL failures against a delivery's `maxAttempts`. Handler failures still retry in order and park at the limit. A parked view row blocks later rows for the same target and key partition; other partitions can proceed. Policy parking is unchanged.
- Add the optional `outboxStatus` callback to `layer` and `fromEnv`. It exposes a read-only worker monitor without changing existing call sites. Skip observation count queries when the callback is absent.
- Replay new or bumped eager views, including emitted entries and views that read views. Eager views have no `kit.catchUp`, including single-source generation-zero views. Adopt unchanged legacy generations without progress as completed baselines, leaving snapshots and entries unchanged. Source-keyed `kit.catchUp` views instead fill each key lazily before ordinary reads, entry scans and live receives. Downstream startup scans read every stored lazy source id, even after downstream completion. Eager replay and lazy fill promote matching pending current-generation live deliveries, preserving queued live view-policy effects. Old-generation history policies stay suppressed; original live deliveries are checkpoint-deduplicated and acknowledged later.
- Persist eager replay progress in the new `backfills` table. Record pending intent atomically with new/bumped view metadata and resets. Bind its JSON `null` plan under the progress lock at startup. A crash before replay cannot cause false legacy adoption. Add nullable `view_keys.filled_generation` for per-key lazy fills. Resume interrupted replay at the next startup.
- Check persisted per-delivery checkpoints, history exhaustion and nonempty routed keys before marking a generation complete. Routed, applied and deduped counts are accounting sanity, not proof of gap-free pre-0.2.0 history. `ModelHost.history` reports replay completion or an adopted baseline. Adopted completion means no pending replay, not gap-free legacy history. Alchemy beta.85 still reports public lazy `View.history` as complete per accessed key, not global fill progress.
- Wake downstream delivery and notify subscribers after lazy read/receive fills commit. Keep non-lazy reads non-transactional; filled lazy reads avoid writes and locks. Unknown ids without events do not persist empty keys.
- Treat handler self-interruption as a retryable handler failure. Mixed child SQL and interruption causes remain infrastructure failures and do not consume attempts. Scope shutdown still interrupts promptly without consuming attempts.
- Reject changed persisted plans with `BackfillPlanChanged`, including complete records. Bump the consumer's version when changing `from` or upstream generations changes its replay plan at the same consumer generation.
- Record lazy/eager mode in nullable `views.catch_up`. Known same-generation lazy-to-eager transitions re-arm the actual eager target without resetting snapshots or entries, including `@n` to `#n` changes. Ordinary eager restarts retain progress. NULL preserves unknown legacy adoption; switching an unrecorded lazy declaration on the first upgrade needs an explicit generation bump.
- Complete fresh empty-model eager jobs in one guarded transaction after committing their pending intents. Keep plan validation, progress checks and separate 128-row pages for nonempty history.
- Check the catalog before adding `view_keys.filled_generation` or `views.catch_up`, avoiding repeated owner-only ALTER on migrated tables.
- Add `parkedCount` to the cached outbox monitor. Treat a nonzero count as unhealthy. The monitor is not a fresh database probe.

### Upgrade notes

Stop the old host before starting the new one. Startup replays new or bumped eager views before it accepts commands or drains the outbox. Unchanged legacy generations adopt without replay. Source-keyed `kit.catchUp` views fill keys on ordinary reads and receives. Large eager histories need a longer startup deadline. Poison lazy history fails reads rather than serving stale snapshots. Schedule firing locks the aggregate instance before deleting its schedule token, matching schedule and unschedule lock order.

Run `migrate(schema)` as the schema owner before starting an app with `createTables: false`. Grant the runtime role access to `backfills`. Default startup runs the idempotent migration itself.

Eager replay orders source views before their consumers. It orders source names and source ids bytewise, then each stream's `seq`. This can differ from live cross-stream interleaving. Completion checks persisted per-delivery checkpoints and exhaustion; counts alone cannot prove gap-free history. Replay cannot repair holes below checkpoints from generations emptied under 0.1.1. The owner must bump those generations for a clean rebuild. Do not blindly reset same-generation view logs that pending consumers still reference.

All SQL failures leave attempts unchanged, including persistent SQLSTATE classes `22`, `23`, `42` and `54`. Such faults block the model drain until repaired, without parking. Alert on `available: false` and inspect the logged SQL fault. Handler retry backoff starts at 50 to 100 ms with no poll-interval floor, so handlers can park sooner than before.

Existing `fromEnv` and `layer` call sites stay valid. Measure startup on production-sized history before deployment. See [README.md](README.md) for health wiring and replay limits.
