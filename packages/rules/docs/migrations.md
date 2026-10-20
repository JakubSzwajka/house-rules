# Module-owned migrations and SQL

house-rules-migrations checks SQL ownership and migrations.json. It never executes SQL. @house-rules/migrations runs the list against Postgres. Runner and checker consume one shared workspace/package fixture file, with failure reasons on each side.

## Locations

Each entry names exactly one nonempty workspace or package location. Workspace migrations stay in migrations/ and retain manifest checks. Installed packages declare houseRules.migrations and resolve from node_modules. Folder locations are rejected.

```json
{"modules":[
  {"workspace":"packages/comments"},
  {"package":"@house-rules/call-audit"}
]}
```

The default name is the package's slugged basename; table defaults to <name>_migrations. Name/table syntax, length, uniqueness and adopt {from,ids,rehash?} validation apply to every location. A real folder cannot be listed twice with different names or location kinds. For both location kinds, migrations/ cannot be a symlink or resolve outside its real owning module. Normal workspace/installed module-root symlinks remain valid; declared workspace roots are followed through them, and SQL is still owned/scanned. A .sql file must be a regular file, never a symlink, even when its target stays inside the module. Both checker and runner reject linked and dangling SQL files under the same policy and shared parity fixtures.

Every module with migrations must be listed. Read-model discovery under src/read-models applies only to configured app workspaces, not shared packages. Read models cannot own migrations.

## Chunks and session settings

The runner and checker mirror one private split algorithm. Both suites read tests/fixtures/migrations/chunk-parity.json in the rules package. A line matching `^--> statement-breakpoint[ \t]*$` is reserved, even inside a quoted body or comment. Splitting happens before SQL lexing. Chunks are trimmed and empty chunks omitted; semicolons inside strings, dollar quotes and comments never split a runner chunk. With the pinned PostgreSQL Effect driver, each chunk must contain one command: unprepared execution still rejects multiple commands. The checker additionally splits each chunk at tokenized semicolons to inspect every DDL statement. It does not promise that admitted SQL will execute.

The runner's first statement inside its transaction is SET LOCAL standard_conforming_strings = on. It repeats that pin before every migration chunk, including chunks in later files. The checker forbids the case-insensitive whole words standard_conforming_strings, backslash_quote, set_config and pg_settings anywhere in module migration/read-model SQL. This raw guard intentionally includes strings, comments and dollar bodies; those words have no module use. It does not flag unrelated JavaScript prose or the runner's internal pin.

Plain and N strings containing backslashes fail in read models and the view-DDL scan. Use E strings or dollar quotes instead. Their boundaries do not depend on the session's standard_conforming_strings mode.

## Ownership and units

CREATE TABLE and supported CREATE VIEW forms assign an owner. A view's SELECT names only that module's tables/views, not another module's objects, unknown relations or schema-qualified look-alikes. ALTER/DROP VIEW, MATERIALIZED VIEW and TABLE may change only owned objects. Cross-module foreign keys fail, including compact quoted references. Keep foreign ids as plain columns and ask the other module's service instead.

Domain modules own SQL as packages. Ordinary module SQL cannot name another owner's objects. SQL files sit directly in the owner's migrations/ directory. Test SQL under a workspace's fixtures/ or tests/ is exempt. Applied migrations are append-only.

Only the entry runtime opens a production unit. Production node handlers, modules, read models and composition cannot call UnitOfWork.atomic. Their writes join the entry's unit through UnitOfWork.required. Tests and tooling outside src may open explicit units: repository-root scripts/ and each workspace's own top-level scripts/ beside package.json. A scripts/ folder inside production src, a module or a node has no exemption. Kit runtime and unit adapters implement units. No partial-handler unit exception exists.

Raw withTransaction and SQL begin/start transaction remain allowed only in unit adapters or named adapter packages. --adapter-package adds project plumbing. The raw transaction scan keeps its comment/string/nested-comment/dollar-body behavior. It treats node handlers as transactional entry work, not scripts allowed to open raw transactions.

## SELECT grammar

Read models use direct SQL client template tags. Acquire a client with a direct yield from an imported SQL service into an unmodified const binding. A bare sql tag is also checked. Client aliases, passing clients to helpers/Reflect, callbacks on SQL services, computed/extracted methods, raw/unsafe calls, connection execute APIs and Statement fragment/identifier APIs fail. SQL-typed client parameters, including local type aliases/generic wrappers, are unsupported and fail when used. Dynamic SQL imports and read-model SQL re-exports fail too. Named imports and star barrels through declared workspace package doors are traced to their SQL import identity. Exported client tags need a SQL client type annotation; imported service tags use the same direct-yield rule. Tags from unrecognized yields, including destructured yields, fail. Unrelated tags and untagged English descriptions are not SQL sources, even when their text says SELECT or Update. An untyped callback on a non-SQL import is not proof of SQL access. A callback on an actual imported or workspace-reexported SQL service is rejected.

The token scanner accepts exactly one SELECT or nonrecursive WITH...SELECT, with an optional final semicolon. Its bounded grammar supports:

- Static unqualified view names, quoted names, aliases, comma lists and inner/left/right/full/cross joins. Subqueries and nonrecursive SELECT CTEs use the same grammar and relation checks.
- Column names, qualified columns, stars, string/numeric/boolean/null literals, arithmetic/comparisons, AND/OR/NOT, IS NULL/boolean, LIKE/ILIKE, IN lists/subqueries, BETWEEN and EXISTS.
- WHERE, GROUP BY, HAVING, ORDER BY with direction/null ordering, and numeric LIMIT/OFFSET. There are no allowed SQL functions, including special current-user/time value functions.

Only comparison values, IN values and LIMIT/OFFSET may interpolate. Values must be scalar literals, const aliases of proven scalars, primitive-typed function parameters, primitive members of structurally typed parameters, or Actor.id/ActorId from domain's own door. Unknown imports, objects, calls, query fragments, identifier values and unproven parameter types fail. Parameters cannot sit inside SQL quotes/comments or supply ORDER BY structure.

```ts
const read = (ownerId: string) =>
  sql`select * from booking_read where owner_id = ${ownerId}`;
```

TABLE subqueries, parenthesized table joins, schema-qualified relations, locking clauses, writes, functions, extra statements and unsupported syntax fail. A query may use at most 10000 tokens and 32 nested parser levels. With standard_conforming_strings on, the lexer follows PostgreSQL scan.l boundaries: only ASCII space, tab, newline, CR, form feed and vertical tab are whitespace. Identifier starts include non-ASCII code units, and identifier continuations include digits and $, so a dollar quote cannot start inside an identifier. It separates standard, E, B, X, N and U& strings, tagged dollar strings, quoted identifiers, line comments and nested block comments. String contents never act as keywords or punctuation. It lexes multi-character PostgreSQL operators in ordinary migrations; unsupported SELECT operators produce a grammar diagnostic. U& quoted-identifier syntax and UESCAPE clauses, typed literals, adjacent string concatenation, casts, recursive queries, set operations and window syntax are outside this SELECT grammar. Literal values are not decoded or type-checked; PostgreSQL checks their values. Real Postgres tests still prove syntax, A/B filtering and behavior. Without a database, composition provides a named read-unavailable port, not a memory store.

## View DDL grammar

The checker reads CREATE [OR REPLACE] [TEMP|TEMPORARY] VIEW and CREATE MATERIALIZED VIEW [IF NOT EXISTS], optional column lists, then AS and the SELECT grammar above. Materialized modifier combinations not in that form fail. RECURSIVE VIEW is rejected explicitly, never registered under a guessed name. View options and WITH [NO] DATA are unsupported. Ordinary views may end with WITH [LOCAL|CASCADED] CHECK OPTION. ALTER/DROP object checks parse their target names, including IF EXISTS, ALTER TABLE ONLY and comma-separated drops; Postgres validates the remaining DDL syntax.

## Output and exit codes

- 0 prints `migrations: no SQL migrations found`, or `migrations: <n> table/view object(s) owned by <m> module(s); no cross-module foreign keys or SQL; <k> module(s) listed in migrations.json`.
- 1 prints the problem count, one `  <path>:<line>: <message>` line per problem and the rule link to stderr. List problems use migrations.json:1.

## Limits

The SELECT/view checks use tokens plus a bounded grammar, not a complete PostgreSQL parser or a type checker. Unsupported syntax fails. Read-model SQL and the view-DDL ownership scan reject any non-ASCII text outside string literals or quoted identifiers with an explicit diagnostic, including comments and unquoted names. Unicode inside strings and quoted names remains valid; U& quoted-identifier syntax is recognized lexically but remains outside the supported ownership/SELECT grammar. This deliberate restriction prevents scanner disagreements from hiding relations or DDL. SQL-source and parameter proof use local AST provenance, not runtime validation or whole-program type inference. Imported SQL APIs and acquired clients cannot escape that proof; an arbitrary unrelated tag or untyped unused wrapper is not presumed to be a database API. Keep module schema types and Postgres privacy tests; this check does not prove the person filter itself. Read-model source is parsed throughout the folder, excluding tests, so moving a query out of adapters does not evade it.

Ordinary module table ownership still uses the older text scan, not this SELECT grammar. It cannot see generated SQL, runtime identifiers or tables created only by another database. ON-table forms such as CREATE INDEX ON, COMMENT ON and GRANT ON are known gaps in that scan. extract(epoch from column) can resemble a table read. Compact quoted names without whitespace after FROM/JOIN and comma lists after a subquery or join condition can be missed by that legacy table scan. The legacy scan uses the shared PostgreSQL lexer per migration chunk and blanks ordinary string literals. DO, LANGUAGE sql and plpgsql dollar bodies get a best-effort nested lexical scan, with raw body text as fallback when body lexing fails. These are not exceptions to the ownership law.

PL/pgSQL, DO bodies and dynamic EXECUTE are not semantically analysed. Their ownership is a review rule, not proved by this checker. A SELECT-only database role granted access to published views is a planned follow-up, not implemented in phase 1.

Transaction/unit scans read code text. Aliased withTransaction, renamed UnitOfWork services and calls hidden by wrappers can evade those scans. The module-list requirement discovers installed runtime dependencies, not devDependencies or peerDependencies. A green checker is not a substitute for review or real database tests.
