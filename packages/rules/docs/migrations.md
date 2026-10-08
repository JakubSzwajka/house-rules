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

`--adapter-package <name>`, repeatable, names another package that may open a raw transaction, such as a plumbing package that wraps the database: `house-rules-migrations --adapter-package @trippy/db`. Any other argument fails.

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
8. **A raw transaction outside an adapter package** (heuristic). Any `src/**` file of a workspace package or a listed installed package, tests included, that calls `withTransaction`, or sends `begin` or `start transaction` in SQL text. SQL text is a template tagged like `sql` (`sql`, `this.sql`), or the first argument of a raw query call (`.unsafe(`, `.execute(`, `.executeUnprepared(`, `.executeRaw(`, `.query(`). There any statement that starts with one of them fails, in any case, after comments, and after a `;`. A dollar-quoted body, such as `DO $$ ... BEGIN ... END $$`, is skipped here, since its `BEGIN` opens a PL/pgSQL block. One scan reads strings, quoted identifiers, comments and dollar bodies together, as Postgres does, so a `"$$"`, a `'$$'` or a `-- $$` neither opens a body nor hides its closing delimiter, and a `begin` after the body still fails. Block comments nest, as in Postgres. This scan also blanks quoted identifiers, so `select 1 as "x; begin"` passes. In a use-case, any string or template part that starts with one fails, SQL text included, so `` sql`${sql.literal("")}begin` `` fails there. Any other string fails only when it is a whole transaction control statement: `begin`, `BEGIN`, `start transaction`, optionally followed by `transaction`, `work`, `isolation ...` or `read ...`, and `;`. So UI text such as `"Begin"` or `"Begin your trip"` passes, and so does SQL behind another tag name or in a plain variable. A use-case opens a unit of work instead: `transactional: true` on its contract, or `UnitOfWork.atomic` from `@house-rules/capability` in its handler. Adapter packages are exempt: `@house-rules/capability`, whose `sqlUnitOfWork` adapter calls `withTransaction`, `@house-rules/migrations`, and every package named with `--adapter-package <name>`, matched by the `name` in its `package.json`.
9. **A module that opens a unit of work** (heuristic). A non-test `src/**` file of a workspace package outside `apps/`, or of a listed installed package, whose code calls `UnitOfWork.atomic` or `unitOfWork.atomic`. A module never opens a unit: its writes run inside the one the use-case opened, and fail with `NoOpenUnit` without one (`UnitOfWork.required`). Apps may open one, in a use-case or a script, and so may tests (a file under a `test`, `tests` or `__tests__` folder, or a `.test.` or `.spec.` file). Adapter packages are exempt.

SQL comments (`--` and `/* */`) and string constants (`'...'` with `''` escapes, and `E'...'` with backslash escapes) are blanked first, in migrations and in SQL strings alike. Nested block comments count as one comment. Quoted identifiers stay for the table checks. TypeScript comments and code are never read as SQL.

## Output and exit codes

- `0`: prints `migrations: no SQL migrations found`, or `migrations: <n> table(s) owned by <m> package(s); no cross-module foreign keys or SQL; <k> module(s) listed in migrations.json`.
- `1`: prints `migrations: <n> problem(s) with module-owned SQL or the module list:` and one `  <path>:<line>: <message>` line per problem, to stderr.

## Limits

This is a text check, not a SQL parser. The transaction checks read code text: they miss a transaction opened through an alias, such as `const { withTransaction: tx } = sql`, or a unit opened through a renamed service. It does not see SQL a query builder generates, a table name built at run time inside `${...}`, or a table only a different database creates. A column that shares a name with another package's table, read after `from` (as in `extract(epoch from ...)`), is a false positive. Rename the column or the table. A comma list is followed only while each item is a name with an optional call, alias and column list: a table after a subquery or a `join ... on` condition, as in `from (select ...) s, place`, is missed. Dollar-quoted bodies are read as SQL, not blanked, by the table checks. The list check does not read `devDependencies` or `peerDependencies`, so a package that ships migrations and is only a dev or peer dependency is not required in the list.
