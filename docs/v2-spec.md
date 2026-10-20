# v2 spike: spec

Status: approved by the owner to build. Revision 3, after two feasibility reviews. Leader: the session that wrote this file. It is a spike: a readable, runnable slice of the v2 shape, built next to today's code so the owner can read real code and then settle the open points. It is not the migration. Nothing in `packages/` changes.

## 1. Outcome

When the spike is done, all of this is true:

1. `examples/booking-v2/` holds a small booking app built in the v2 shape: nodes, a node graph, a caller context, entries that own the gates, sockets with plugs, ways in, and a read module.
2. `examples/booking-v2/REGISTRY.md` is generated from the code. It shows every node, who calls whom, every ⚙ system edge with its reason, and each entry's two permission closures. A test fails when the file is stale.
3. Tests prove the behaviours in section 9.
4. `pnpm check` and `pnpm test` exit 0 from the repo root, with the local Postgres from `docker compose up -d` running.
5. `examples/booking-v2/README.md` gives the owner a reading order.

## 2. The v2 shape in short

This section is the whole design the spike builds. It is self-contained on purpose.

- **Node.** One type for everything the system can do or read. A node has a name, input, output, failure, its own permission (or none), the flags `readOnly`, `destructive`, `transactional` and `needsApproval`, and its **edges**: the nodes it may call. That is today's contract plus edges. Command or query is the `readOnly` flag. Where a node is defined is a place, not a type.
- **Edge.** Declared statically on the calling node: a target node, a caller mode (`person` or `system`), and for a system edge a non-empty reason. For example: `edges: [Bookings.cancel, asSystem(Billing.refund, "refund after cancel")]`. The handler can only call declared edges, through a `call` scoped to that node. Registry generation and runtime calls read the same declaration.
- **Caller context.** Every call carries who is calling: `Person { actor, via }`, where `via` is the way in, or `System { reason, startedBy }`. A system edge switches to `System` for that call. **Once a call runs as the system, everything below it runs as the system.** It never switches back to a person. There are no special "system nodes".
- **System permissions.** The system has its own permission list, provided by the composition, so it cannot do everything.
- **Closures.** For an entry, the **person closure** is the entry node's own permission plus the permissions of every node reached through person edges, stopping at the first system edge. The **system closure** is the permissions of every node at or below a system edge, plus everything when the entry itself starts as the system. Deduplicate both. The graph must have no cycles. Building the graph rejects a cycle.
- **Entry.** Where a call graph starts: a way in (web, partner, MCP), a socket hook (first sign-in) or a schedule. The entry runs the gates **once** for its whole graph, in this order:
  1. Record opens.
  2. Both closures are checked.
  3. Approval is asked once, if any reachable node needs it.
  4. One transaction opens, if any reachable node is transactional.
  5. The nodes run. Inner calls never run approval, never open a transaction, and never write a record row of their own.
- **Module.** A boundary that owns its data and rules, and offers its nodes. It has ports (storage, outside services) filled by adapters. It never opens a transaction and never imports the app.
- **Read module.** Query nodes that read the database directly. They join only **published read views** that other modules create in their own migrations, never their private tables. A read module never writes, and it filters by the person calling, in SQL.
- **Socket and plug.** A socket is a question every app answers around each call. A plug answers it as one bundle and fills today's Effect slots inside it.
  - "Who is this?": token source, Authenticator, ActorResolver, and the new-login policy.
  - "What may they do?": Grant and the closure check. One plug per way in, plus one for the system.
  - "Do they mean it?": Approval.
  - "Record every call": CallWatch.
- **Way in.** A named entry point with a path, its plugs for "Who", "May" and "Mean", its views, and the list of entries it exposes. The Host routes from the list of ways in, never from a hand-written `if`-chain.
- **Composition.** It does five things: mount modules, link modules, plug sockets, open ways in, and schedule entries.

## 3. Defaults for the open points

The owner has not settled these. The spike uses the default and marks it, so the owner can judge it while reading.

| Id | Open point | Default in the spike | Switch |
| --- | --- | --- | --- |
| P2 | Who runs the gates | **C**: the entry checks both closures first, and every inner call re-checks its own node's permission as a backstop | a named gate-policy option, `"entry-and-recheck"` (default) or `"entry-only"` (option **A**) |
| X | What a way in may expose | Only entries made from **app nodes**: nodes the app defines, wherever their file lives. A module's node is never exposed directly, even for 1:1 cases. A registry test checks it | none |
| P1 | Details of the caller context | As in section 2: the system's own list, a non-empty reason, the system mode inherited downward, two closures | none |
| H | Proposals not yet reviewed | Three kinds of entry. Declared, type-checked edges. Approval lifts to the entry. One transaction per entry. One record row plus a step trace. Views per way in. Read-only queries with an access test. The five composition verbs | none |

How to mark a default:

1. List every default in `examples/booking-v2/DEFAULTS.md`, with the file and the exported symbol that implements it.
2. In code, make each default a named, exported value or option where possible. Use no long comments, because `pnpm check` runs a comment rule. Explain in the markdown files instead.

## 4. The nodes, permissions and lists

These choices decide the closures, approval and transactions. Use them exactly.

| Node | Defined by | Own permission | Flags | Edges |
| --- | --- | --- | --- | --- |
| `Bookings.get` | bookings | `bookings:read` | readOnly | — |
| `Bookings.book` | bookings | `bookings:write` | transactional | — |
| `Bookings.cancel` | bookings | `bookings:cancel` | transactional, destructive, needsApproval | — |
| `Billing.initPayment` | billing | `billing:charge` | transactional | — |
| `Billing.refund` | billing | `billing:refund` | transactional, destructive | — |
| `Billing.expirePending` | billing | `billing:expire` | transactional | — |
| `MyStuff.myBookings` | my-stuff | `bookings:read` | readOnly | — |
| `People.createPerson` | app (wraps `@house-rules/party`) | `party:create` | transactional | — |
| `People.bindLogin` | app (wraps `@house-rules/identity`) | `identity:bind` | transactional | — |
| `make_booking` | app | none | — | `Bookings.book`, `Billing.initPayment` |
| `book_for_partner` | app | none | — | `Bookings.book` |
| `cancel_booking` | app | none | — | `Bookings.cancel`, ⚙ `Billing.refund` "refund after cancel" |
| `show_booking` | app | none | readOnly | `Bookings.get` |
| `my_bookings` | app | none | readOnly | `MyStuff.myBookings` |
| `first_sign_in` | app | none | — | `People.createPerson`, `People.bindLogin` |
| `nightly_cleanup` | app | none | — | `Billing.expirePending` |

Behaviour notes:

1. **`Bookings.cancel`'s policy:** only the owner of an active booking. To anyone else, the booking reads as not found.
2. **`Billing.refund`'s policy:** the system may refund a paid payment. A person may not.
3. **`Billing.expirePending`** marks pending payments older than 24 hours as `expired`, reading the time from Effect's `Clock`.
4. **`first_sign_in` and `nightly_cleanup` start as the system.** Their person closure is empty. Every node they reach is in their system closure.
5. **An entry contract carries its app node's `readOnly` and `destructive` flags.** MCP and HTTP read them from there. A `readOnly` app node may only have `readOnly` edges.

| Grant list | Permissions |
| --- | --- |
| member (way in `web`) | `bookings:read`, `bookings:write`, `bookings:cancel`, `billing:charge` |
| partner (way in `partner`) | `bookings:write` |
| agent (way in `mcp`) | `bookings:read` |
| system | `billing:refund`, `billing:expire`, `party:create`, `identity:bind` |

| Way in | Path | Who is this? | Do they mean it? | Exposes |
| --- | --- | --- | --- | --- |
| `web` | `/api` | local JWT, bearer | always no (plain HTTP) | `make_booking`, `show_booking`, `my_bookings`, `cancel_booking` |
| `partner` | `/partner` | local JWT, bearer (a second issuer instance) | always no | `book_for_partner` |
| `mcp` | `/mcp` | outside issuer from `MCP_AUTH_ISSUER`. Fails closed when unset, the same as today, including the metadata paths from `protectedResource` | elicitation | `show_booking`, `my_bookings` (read-only, as the law asks of first tools) |

## 5. Scope

### Must build

#### 1. Kit package

`@example/v2-kit`, at `examples/booking-v2/packages/kit`. It builds on `@house-rules/domain` and `@house-rules/application` and changes neither. Use subject folders such as `src/node/`, `src/caller/`, `src/entry/`, `src/registry/` and `src/socket/`. No loose files in `src/`.

- **The node type**, with declared edges and `asSystem(target, reason)`.
- **The handler's scoped call.** A handler gets a `call` that accepts only that node's declared edges, enforced by types. The call runs with the right caller context and joins the open unit of work. It re-checks the target's permission under default C, against the person's grant or the system's list. It adds one step to the step trace.
- **The caller context service**, with `Person` and `System`. `System.startedBy` is a short text: the entry name and the person (`"cancel_booking · <actorId>"`), `"hook:new-login"` or `"schedule:nightly_cleanup"`.
- **The entry adapter.** It turns an app node into exactly one capability, built with `defineContract` and `implement` from `@house-rules/application`, so today's `toFetchHandler`, `toMcpHandler` and `call` serve it unchanged, and the unit of work is opened by the application kit. Do not call `UnitOfWork.atomic` in the kit: the migrations check flags it.
  - The entry contract lifts `needsApproval` and `transactional` from the graph.
  - Its `permission` is a synthetic entry permission, `entry:<name>`.
  - The way in's "What may they do?" plug answers `entry:<name>` by checking both closures: the person closure against the way in's list, the system closure against the system's list. That puts both closure checks at the Grant step, before Approval and before the transaction.
  - `Forbidden.permission` names the entry permission. The step trace and a log line name the missing permission.
  - Inner calls never go through a second `implement`.
- **Registry generation:**
  - A pure function that takes the app's entries and nodes as data and returns the markdown of `REGISTRY.md`.
  - A separate script that writes the file.
  - A test that compares the file with fresh output and fails on any difference. It never rewrites the file.
  - The kit never imports the app.
- **The step trace.** A small service, owned by the example, that collects one step per inner call: target, caller kind, system reason, outcome and order. It is keyed by the entry's request id and kept in memory. call-audit stays unchanged and records only the entry's one flat row. Persisting steps is out of scope.
- **Socket plugs.** Thin named bundles over today's slots:
  - a local-JWT "Who is this?" built on `AuthJwtLocal` and `Identity.caller`
  - a closure-aware fixed-list "What may they do?", including the system's list
  - the existing Approval layers
  - call-audit for "Record every call"

#### 2. Module `@example/v2-bookings`

At `examples/booking-v2/packages/bookings`.

- Table `v2_booking` (`id`, `guest_name`, `owner_id`, `status`). Published view `v2_booking_read`, created in this module's own migration over its own table.
- A storage port, a memory adapter, a Postgres adapter, and one shared store suite.
- Its nodes as in section 4, plus a `relation` method.
- Node descriptors are exported beside the `defineModule` service, not inside its method shape.

#### 3. Module `@example/v2-billing`

At `examples/booking-v2/packages/billing`. It's imagined, for the demo.

- Table `v2_payment` (`id`, `booking_id`, `owner_id`, `amount`, `status`, `created_at`). `booking_id` is a plain column, not a foreign key. Published view `v2_payment_read`.
- Port `PaymentStore`, with memory and Postgres adapters and a shared store suite.
- Port `PaymentProvider`, with a fake adapter only: no network, no real provider. The fake records its calls, so tests can assert that none happened.
- Its nodes as in section 4.

#### 4. Read module `@example/v2-my-stuff`

At `examples/booking-v2/packages/my-stuff`. It runs under the owner's **spike-only exception** (section 7).

- One query node, `MyStuff.myBookings`.
- Its SQL sits in `src/adapters/postgres/`, behind a port. It selects from `v2_booking_read` joined with `v2_payment_read`, filtered by the person calling.
- It has a Postgres adapter only, and no memory adapter.
- It never writes.

#### 5. App `@example/v2-api`

At `examples/booking-v2/apps/api`.

- **App nodes and `People` wrappers**, as in section 4. They live where the checks allow.
  - App code may only sit in `src/delivery`, `src/server`, `src/use-cases` and `src/composition`. Each use-case file must export exactly one capability, written as a direct `implement(...)` call imported from `@house-rules/application`.
  - Either write each entry's use-case file as `implement(<entry contract>, <entry handler>)`, built by kit helpers, or define app nodes in an example package and expose them from delivery.
  - Choose one and record it in `DEVIATIONS.md`. App-ness is a logical marker, not a folder.
- **Ways in** as in section 4. `main.ts` routes from the list of ways in. The list includes the MCP metadata paths.
- **First sign-in.** The "Who is this?" plug's new-login policy is a `FirstSignIn` filler.
  - It runs the `first_sign_in` entry in-process with `System { reason: "new login", startedBy: "hook:new-login" }` and the system's list. It never authenticates again.
  - It yields the already-gated capability's Effect handler, with its long-lived services captured and the system's Grant provided. It never calls the Promise-returning delivery `call`, and never builds a second composition.
  - It maps any failure to `Refused` and returns the new person's id.
  - It must not depend on the request's `CurrentActor` or Grant, because those don't exist yet.
- **The composition** reads as the five verbs:
  - Plug "Record every call" with call-audit's memory layer, or its Postgres layer when `DATABASE_URL` is set.
  - Add the schedule entry `nightly_cleanup`. A test that runs it once is enough. No real timer.
- **Configuration.** Reuse only variables that already exist in `.env.schema`: `DATABASE_URL`, `MCP_AUTH_ISSUER`, `NODE_ENV`, `PORT`, `APP_ORIGIN`. The local JWT plugs are a named demo option in code. The app refuses to start with them when `NODE_ENV=production`. Add no new variable.

#### 6. Reading aids

All under `examples/booking-v2/`:
- `README.md`: about 400 words. What this is, and the reading order.
- `DEFAULTS.md`.
- `DEVIATIONS.md`.
- The generated `REGISTRY.md`.

Explain the two different `call` functions with import aliases. One is the in-process way in from `@house-rules/application`. The other is the inner call inside a node.

### Out of scope

1. The data socket (P4). Keep today's storage adapters and unit-of-work layers.
2. Any change to `packages/` (the framework), to root config (`biome.json`, `eslint.config.mjs`, `.dependency-cruiser.cjs`, `tsconfig*.json`, `turbo.json`, `lefthook.yml`, `pnpm-workspace.yaml`, `.env.schema`, CI), or to `AGENTS.md`.
3. Modules as folders inside the app. Today's checks forbid it. Modules stay packages, and `DEVIATIONS.md` says so.
4. A web page or UI. Real payment providers. New external dependencies: use only versions already in `pnpm-lock.yaml`. Write tools on MCP.
5. Persisting the step trace, or changing call-audit.
6. `examples/booking-platform/`, and every file in the owner's baseline (section 6). Do not touch them.
7. Commits, pushes and PRs. Leave every change uncommitted.

## 6. Allowed paths and the baseline

| Path | Who may write it |
| --- | --- |
| `examples/booking-v2/**` | the orchestrator's lanes |
| `migrations.json` | the orchestrator's lanes: add `@example/v2-bookings` and `@example/v2-billing` only, as `{ "workspace": …, "name": "v2_bookings", "table": "v2_bookings_migrations" }` and the same for billing. Never re-add party, identity or call-audit |
| `pnpm-lock.yaml` | changed only by one plain `pnpm install` for the new workspace packages, run by the builder. The verifier then runs `pnpm install --frozen-lockfile` |
| `docs/v2-spec.md` | the leader only. Lanes ask; they never edit it |

The checkout already holds the owner's uncommitted work. Its `git status --porcelain` before the spike is saved at `/home/kuba/.local/state/v2-spike/baseline-status.txt`. The leader recorded a SHA-256 of every file it lists (except this spec) in `/home/kuba/.local/state/v2-spike/baseline-hashes.txt`. Never stage, restore, clean or commit any of those files.

Prefix every new SQL object (tables, views, indexes, constraints) with `v2_`.

## 7. The owner's spike-only exception

Today's law says a package reads another module's data only through its service, never its SQL (`AGENTS.md`, "Modules own their data"). The owner grants **one** exception, for this spike only:

- `@example/v2-my-stuff` may `SELECT` from `v2_booking_read` and `v2_payment_read`.
- It never names a private table. It never writes. It has a Postgres adapter only.
- Without `DATABASE_URL`, the composition plugs a named "read unavailable" port instead. It holds no rows and no storage. It fails with a typed `ReadUnavailable`, and the ways in show it as 503 `unavailable`. That is not a memory adapter. The read tests run on real Postgres only.
- `AGENTS.md` does not change. `DEVIATIONS.md` lists the exception.

The exception becomes law only with the v2 migration, together with a check that enforces it. Every other rule in `AGENTS.md` holds in full.

## 8. Hard constraints and how it is built

1. Follow `AGENTS.md` (exact pins, typed errors, `it.effect` and `it.layer`, no `Effect.run*` in tests, one service per file, subject folders, a module never opens a unit of work), except for section 7.
2. Never loosen or skip a check. Never use `--no-verify`.
3. If a check blocks a piece in its planned place, put it in the nearest legal place and write one line in `DEVIATIONS.md`: what, where, which check, and the place the v2 shape wants.
4. If no legal place exists, or a decision in sections 2 to 4 turns out wrong in code, stop that piece and ask the leader through intercom. Do not redesign.

The leader starts one orchestrator: a top-level pi in its own herdr workspace, in this checkout. The orchestrator plans and runs its own lanes as `~/.agents/ORCHESTRATION.md` says:

1. Run one writer at a time in this checkout.
2. Build the kit first, and verify its contract (edges, the scoped call, the entry adapter, closures, the step trace) before the modules and the app build on it.
3. Run one task verifier, from the other model family, after the last writer.
4. Pick the cheapest model that fits each lane.

The orchestrator reports to the leader through intercom when it is done, or when something is missing or blocked. It never edits this spec.

## 9. Acceptance

The task verifier checks each item and reruns each command.

1. From the repo root, these all exit 0: `pnpm install --frozen-lockfile`, `pnpm check` and `pnpm test`. Postgres must be running for the tests.
2. `REGISTRY.md` exists, and its freshness test passes without rewriting it. It shows:
   - two callers of `Bookings.book`: `make_booking` and `book_for_partner`
   - the ⚙ edge from `cancel_booking` to `Billing.refund`, with its reason
   - both closures for every entry
   - which way in exposes each entry
3. **Closure refusal.** `make_booking` is refused with `Forbidden` when the caller lacks `billing:charge`. No booking row is written, and the fake provider is never called. The same refusal happens over the `web` way in (HTTP) and in-process.
4. **Cancel with refund.** The person cancels, and the refund runs as the system with reason "refund after cancel". The step trace shows two steps, in order, with their caller kinds. When `billing:refund` is removed from the system's list, the whole entry is refused before anything runs, and the trace shows no steps.
5. **Approval.**
   - `cancel_booking` is refused on the `web` way in, where approval is always no.
   - It succeeds in-process, with approval allowed.
   - A counting Approval proves it's asked once for an entry that needs approval, and never for an entry that doesn't.
6. **One transaction.**
   - A counting UnitOfWork proves one unit for a transactional entry, and none for a read-only one.
   - On real Postgres, a failing refund rolls back the cancel.
7. **The read module.** On real Postgres, B cannot see A's rows. A test owned by the example reads the read module's source and SQL, and fails if the SQL:
   - names `v2_booking` or `v2_payment` as whole identifiers
   - contains anything other than `SELECT`
8. **First sign-in.** A new login runs `first_sign_in` through the new-login hook, as the system. It creates a Person, binds the login, and returns the person's id.
9. **The gate-policy switch.** Under `"entry-only"`, inner calls skip the re-check. A test shows the difference: an inner node's permission is missing from its list, but the closure passes, because the test builds the closure by hand.
10. **The graph.**
    - Building a graph with a cycle is rejected.
    - A test-only graph shows that a person edge below a system edge still runs as the system, with the expected closures and reason.
11. **Records.**
    - call-audit holds one row per entry, and none for inner calls.
    - A refused entry also gets one row.
12. **MCP.**
    - Real MCP calls run both tools, with fake actors. User B cannot read user A's data through either tool.
    - `tools/list` advertises both tools with `readOnlyHint: true`.
    - It answers a call with no token with 401 and a `WWW-Authenticate` challenge that names `resource_metadata`.
    - It serves the resource metadata, refuses a token with the wrong audience, and answers 503 `not_configured` when no issuer is set.
13. **Exposure.** A test fails if any way in exposes a node that isn't an app node.
14. **Type tests.** These invalid expressions are rejected under `@ts-expect-error`, inside the test body, while the typecheck exits 0:
    - a scoped call to a node that isn't a declared edge
    - `asSystem` with a literal empty reason

    The reason must also be checked at run time.
15. **Reading aids.**
    - `DEFAULTS.md` lists every default in section 3, with file and symbol.
    - `DEVIATIONS.md` lists every deviation, and the exception in section 7.
    - `README.md` gives a reading order.
16. **The delta.** Compared with the baseline:
    - new and changed files appear only in the allowed paths of section 6
    - every file in the baseline still has its recorded SHA-256
    - nothing is staged or committed
