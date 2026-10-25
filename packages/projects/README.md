# @house-rules/projects

Project records with configurable statuses and unique slugs. This support module is not in the public publish workflow.

## Mount

```ts
const projects = Projects.layerPostgres(Projects.presets.default);
const mount = { ...ProjectsMount, layer: projects };
```

Provide the shared SQL client and sqlUnitOfWork in the module plan's infrastructure. Use Projects.layerMemory with memoryUnitOfWork for memory storage. Register packages/projects in migrations.json, or the package identity when installed. Composition binds operations through bindProjects once. Features call ProjectsOperations through declared edges; write operations lift transactional.

## Options

Projects.presets.default supplies statuses active/archived, defaultStatus active and archivedStatus archived. Configuration must list distinct, nonempty statuses and contain both chosen statuses. Statuses are exact, case-sensitive strings. Set all options when overriding the preset, or spread it to change selected values.

The default slug rules trim and lowercase input, require a letter or digit first, then lowercase letters, digits or hyphens, and cap length at 64 UTF-16 units. Configure slug.pattern as a regular-expression source, slug.maxLength, slug.lowercase and slug.trim. The pattern applies after normalisation; use anchors for whole-slug rules. Invalid regex syntax fails acquisition as ProjectInputInvalid. Slugs remain unique regardless of status. Names are trimmed and require 1 to 200 UTF-16 units. Descriptions are plain text, defaulting to an empty string. Invalid slug, name or status returns ProjectInputInvalid with the field and a safe user-facing message. Invalid configuration uses field options.

## Operations and facts

| Operation | Input | Result |
| --- | --- | --- |
| create | slug, name, optional status and description | project plus ProjectCreated fact |
| update | ref and patch with optional slug/name/status/description | project plus ProjectUpdated fact when changed |
| show | `{ id }` or `{ slug }` | project |
| list | optional status | projects ordered by lowercased name, then slug |
| archive | `{ id }` or `{ slug }` | update result using archivedStatus |

List without a status includes all projects, including archived records. Apps must filter the statuses they want to show. Slug changes are allowed; apps that forbid them must enforce that rule in their features. Explicit status filters are validated. Ordering uses JavaScript lowercase and code-unit comparison in both adapters, independent of database collation. Archive is a status change, not a delete. A repeated archive or unchanged patch returns the existing project with an empty events array and leaves updatedAt unchanged. Timestamps are epoch milliseconds. Facts contain plain project snapshots without envelopes; a feature may record them through its own event-log edge.

## Access

Person operation callers need projects:read or projects:write. All bindings refuse system callers, even with those grants. The raw service accepts an explicit Actor and assumes the composing layer has checked permissions. Without ProjectAccess there is no object access rule. To restrict objects, provide ProjectAccess when acquiring Projects. access(actor, projectId) returns write/read/none; null checks creation. visibleProjects(actor) returns ids to filter lists in storage, including SQL. A read relation cannot write. Denied reads or changes return ProjectNotFound; denied creation returns ProjectAccessDenied. Map host failures to ProjectAccessUnavailable. The port belongs to Projects and stores no host policy.

## Storage

Both adapters require an open unit for writes and support rollback. Postgres serializes module mutations with a transaction-scoped advisory lock to preserve rename uniqueness and prevent lost field updates. Seed scripts and other direct writers must take the same `pg_advisory_xact_lock(hashtext('house-rules/projects'))` in their transaction before checking or writing slugs. Otherwise, concurrent duplicates can return ProjectStoreUnavailable rather than ProjectSlugTaken. It decodes rows through Schema. The projects_view publishes only this module's columns. Consumers must apply their own access filters when selecting that view. Run the shared memory/Postgres suites with `pnpm --filter @house-rules/projects test`; database tests use MigrationsTesting.database.

## Board adoption

Configure active/paused/done/archived and the board slug pattern `^[a-z0-9][a-z0-9_-]{0,63}$`, with lowercase and trim disabled, to keep board's strict slug acceptance. The default framework rules instead normalise case/space and reject underscores. Board's list hides done/archived by default; this list includes every status unless one status is requested. Board's ordering uses PostgreSQL lower(name) and its collation; this module uses deterministic JavaScript comparison. Board's no-op update is null; here it is a project with no facts. Records expose a stable text id and epoch-millisecond createdAt/updatedAt instead of board's createdAt string and hidden UUID. Slug changes are supported. Joined task counts, repositories, tasks and notes remain app read-model work. Board keeps owner/agent writes in composition's access port. No board files are changed by this package.
