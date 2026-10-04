# Module-owned SQL checker

Bin: `house-rules-migrations` (`bin/migrations.mjs`)

A module owns its migrations and its tables. The bin reads every SQL migration and every SQL string in the workspace, and fails when one module reaches into another module's tables. A repository with no SQL passes.

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

## What fails

1. **A cross-module foreign key.** A migration `references` a table another package owns. Keep the id as a plain column and ask the other module's service for the record.
2. **A migration that touches another package's table**: `alter table`, `drop table`, `truncate`, or `insert into`, `update`, `from`, `join`, `using` naming it.
3. **A table two packages create.** The second creator is reported.
4. **Module SQL that names another package's table.** In every `src/**/*.{ts,tsx,mts,cts}` of every workspace package, apps included, the bin reads string literals and template literals that hold a SQL keyword (`select`, `insert`, `update`, `delete`, `alter`, `drop`, `truncate`, `merge`). A name after `from`, `join`, `into`, `update`, `using`, `truncate`, or `alter/drop table` that another package owns fails, with or without `only`, and so does every table in a comma list such as `from trip t, "user" u`. JavaScript escapes such as `\"` are decoded first, and each `${...}` reads as a placeholder. This also fails when a plumbing package, such as `db`, owns tables a module queries: move the migration into the module.
5. **A `.sql` file outside a `<package>/migrations/` folder**, nested folders under `migrations/` included. `node_modules` and dot folders are skipped. A `.sql` file under a `fixtures/` or `tests/` folder inside a workspace package, such as `packages/db/fixtures/bad-name/0001-bad-name.sql`, is test data: it is neither a migration nor a problem, and its tables have no owner.
6. **A use-case that opens a transaction** (heuristic). A file under `<package>/src/use-cases/` that calls `withTransaction`, or holds a SQL string that starts with `begin` or `start transaction`. One module write method is one transaction; a read method may run without one.

SQL comments (`--` and `/* */`) and string constants (`'...'` with `''` escapes, and `E'...'` with backslash escapes) are blanked first, in migrations and in SQL strings alike. Quoted identifiers stay. TypeScript comments and code are never read as SQL.

## Output and exit codes

- `0`: prints `migrations: no SQL migrations found`, or `migrations: <n> table(s) owned by <m> package(s); no cross-module foreign keys or SQL`.
- `1`: prints `migrations: <n> problem(s) with module-owned SQL:` and one `  <path>:<line>: <message>` line per problem, to stderr.

## Limits

This is a text check, not a SQL parser. It does not see SQL a query builder generates, a table name built at run time inside `${...}`, or a table only a different database creates. A column that shares a name with another package's table, read after `from` (as in `extract(epoch from ...)`), is a false positive. Rename the column or the table. A comma list is followed only while each item is a name with an optional call, alias and column list: a table after a subquery or a `join ... on` condition, as in `from (select ...) s, place`, is missed. Dollar-quoted bodies are read as SQL, not blanked.
