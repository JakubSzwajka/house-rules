# Module-owned SQL checker

Bin: `house-rules-migrations` (`bin/migrations.mjs`)

A module owns its migrations and its tables. The bin reads every SQL migration and every SQL string in the workspace, and fails when one module reaches into another module's tables. It also checks the module list, `migrations.json`, against the modules that have migrations. A repository with no SQL and no module with migrations passes.

```json
// package.json
{
  "scripts": {
    "migrations": "house-rules-migrations"
  }
}
```

## Ownership

The bin finds the workspace packages from the `packages:` list in `pnpm-workspace.yaml`, or `apps/*` and `packages/*` when there is none. A workspace package is a matching folder with a `package.json`. Its migrations are the `.sql` files directly in `<package>/migrations/`.

A table belongs to the package whose migration runs `create table` for it. `create table if not exists`, `temporary`, `unlogged`, quoted names (a doubled `""` inside one included), and a schema prefix such as `public.place` or `"auth"."user"` are read. Names compare without the schema and without case.

## The module list

`migrations.json` at the repository root names every module whose migrations the app runs. The runner, `@house-rules/migrations`, reads the same file, and its README describes every key.

```json
{
  "modules": [
    { "workspace": "packages/trips", "table": "db_migrations" },
    { "package": "@house-rules/call-audit" }
  ]
}
```

A module must be listed when it is:

- a workspace package with a `migrations/` folder. A workspace package keeps its migrations there and nowhere else; a `houseRules.migrations` field that names another folder fails (item 7);
- a package in the `dependencies` of the root `package.json` or of a workspace package, not a `workspace:` one, whose installed `package.json` declares `"houseRules": { "migrations": "<folder>" }`. The bin finds it by walking up from the depending package to the first `node_modules` that holds it.

A listed package's migrations count like a workspace package's: the package owns the tables they create, and no workspace SQL may name them. Its `.sql` files are the ones directly in the declared folder, and its shipped `src/` is read like a workspace package's `src/` (item 4): its SQL may name only the tables it owns.

## What fails

1. **A cross-module foreign key.** A migration `references` a table another package owns. Keep the id as a plain column and ask the other module's service for the record.
2. **A migration that touches another package's table**: `alter table`, `drop table`, `truncate`, or `insert into`, `update`, `from`, `join`, `using` naming it.
3. **A table two packages create.** The second creator is reported.
4. **Module SQL that names another package's table.** In every `src/**/*.{ts,tsx,mts,cts}` of every workspace package, apps included, and of every listed installed package, the bin reads string literals and template literals that hold a SQL keyword (`select`, `insert`, `update`, `delete`, `alter`, `drop`, `truncate`, `merge`). A name after `from`, `join`, `into`, `update`, `using`, `truncate`, or `alter/drop table` that another package owns fails, with or without `only`, and so does every table in a comma list such as `from trip t, "user" u`. JavaScript escapes such as `\"` are decoded first, and each `${...}` reads as a placeholder. This also fails when a plumbing package, such as `db`, owns tables a module queries: move the migration into the module.
5. **A `.sql` file outside a `<package>/migrations/` folder**, nested folders under `migrations/` included. `node_modules` and dot folders are skipped. A `.sql` file under a `fixtures/` or `tests/` folder inside a workspace package, such as `packages/db/fixtures/bad-name/0001-bad-name.sql`, is test data: it is neither a migration nor a problem, and its tables have no owner.
6. **A module the list leaves out.** No `migrations.json` while a module has migrations, or a list that does not name a module it must name. The message gives the entry to add.
7. **A list entry the runner cannot use.** The file is not JSON with a `modules` array; an entry names both or neither of `workspace` and `package`; a `workspace` that is not a workspace package or has no migrations; a `package` the repository root cannot resolve in `node_modules`, or one that does not declare `houseRules.migrations`; two entries that share a module name or a history table; a `name` that is not a lowercase slug, or a `table` that is not a lowercase SQL name, or either one that is not a string; a workspace package whose `houseRules.migrations` names a folder other than `migrations/`. List problems are reported at `migrations.json:1`.
8. **A use-case that opens a transaction** (heuristic). A file under `<package>/src/use-cases/` that calls `withTransaction`, or holds a SQL string that starts with `begin` or `start transaction`. One module write method is one transaction; a read method may run without one.

SQL comments (`--` and `/* */`) and string constants (`'...'` with `''` escapes, and `E'...'` with backslash escapes) are blanked first, in migrations and in SQL strings alike. Quoted identifiers stay. TypeScript comments and code are never read as SQL.

## Output and exit codes

- `0`: prints `migrations: no SQL migrations found`, or `migrations: <n> table(s) owned by <m> package(s); no cross-module foreign keys or SQL; <k> module(s) listed in migrations.json`.
- `1`: prints `migrations: <n> problem(s) with module-owned SQL or the module list:` and one `  <path>:<line>: <message>` line per problem, to stderr.

## Limits

This is a text check, not a SQL parser. It does not see SQL a query builder generates, a table name built at run time inside `${...}`, or a table only a different database creates. A column that shares a name with another package's table, read after `from` (as in `extract(epoch from ...)`), is a false positive. Rename the column or the table. A comma list is followed only while each item is a name with an optional call, alias and column list: a table after a subquery or a `join ... on` condition, as in `from (select ...) s, place`, is missed. Dollar-quoted bodies are read as SQL, not blanked. The list check does not read `devDependencies` or `peerDependencies`, so a package that ships migrations and is only a dev or peer dependency is not required in the list.
