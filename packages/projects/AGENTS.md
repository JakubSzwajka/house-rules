# @house-rules/projects: notes for agents

Projects is a capability module owning project records, not tasks, repositories or notes. Read `README.md` for options and adoption differences.

## Mount and bind

Use `Projects.layerPostgres(options)` with the shared SQL client, or `Projects.layerMemory(options)` with the memory unit adapter. Raw `Projects.layer(options)` needs `ProjectStore`. Storage statics default to `Projects.presets.default`; raw Projects.layer requires options. Add `{ ...ProjectsMount, layer }` to the module plan. Composition captures Projects and calls `bindProjects` once through Runtime. Features call `ProjectsOperations.create/update/show/list/archive` through declared edges.

Register `{ "workspace": "packages/projects" }` in migrations.json. Installed consumers use `{ "package": "@house-rules/projects" }`. Migrations own `projects` and publish `projects_view` over that table alone. The view exposes id, slug, name, status, description, created_at and updated_at. Read models must filter access themselves.

## Access and facts

Person callers need `projects:read` or `projects:write`. All operation bindings refuse system callers with ProjectAccessDenied, even when system permissions include those grants. No ownership is stored or inferred. Without ProjectAccess, every permitted person can access every project. Composition may provide ProjectAccess before acquiring Projects. Its access method takes the actor and project id, or null for creation, and returns write/read/none. Its visibleProjects method returns ids for storage filtering. Lists trust that id set. Denied existing objects appear not found; denied creation is forbidden. Port failures use ProjectAccessUnavailable.

Writes return `{ project, events }`. ProjectCreated carries the stored project. ProjectUpdated carries before and after, including slug changes and archiving. No-op changes return the unchanged project and no events. Import ProjectEvents from the browser-safe contract door. The composing layer decides whether to record facts. Projects never emits events or reads CurrentActor.

Writes require an open unit and never open one. Memory registers undo before mutation. Postgres serializes module writes with a transaction advisory lock, then joins the open transaction. Do not remove the lock without preserving atomic slug conflicts and read/modify/write behaviour. Invalid input returns ProjectInputInvalid with field slug/name/status and a safe user-facing message; invalid configuration uses field options. Unavailable errors expose fixed text, never their cause.
