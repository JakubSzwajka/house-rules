# Context

House-rules is a TypeScript workspace template for apps built on Alchemy Domain. It publishes two packages: `@house-rules/rules` (presets and checks) and `@house-rules/stack` (auth, access and reusable domain modules). [AGENTS.md](AGENTS.md) is the law. This file names the parts; [VISION.md](VISION.md) says why they exist. Alchemy's own words come first; house-rules adds only what Alchemy leaves open.

## The model

A **Model** (`Domain.Model`) is one bounded context: the aggregates, views, policies, projections, streams and sagas an app composes. `Domain.verify(Model)` lists what is wrong with it; a correct model returns an empty list.

An **Aggregate** holds state whose rules must hold in one transaction, keyed by its **id** (`<noun>.id.ts`). It **decides** commands against its state and **evolves** by applying its events. `decide` is pure or reads only middleware context; `evolve` and `reply` are total.

A **Command** is a request to change something, named `<Verb><Noun>`. It targets one aggregate, lists the events it may record, the rejections it may return and its middleware.

An **Event** is a fact the business records, named in the past tense. Events are the record: nothing else is stored. Events that record a change by someone carry `by`, from `authorOf(actor)`.

A **Rejection** is a way a command is refused, returned from `decide` and listed in the command's `rejects`. `Forbidden` (403) is the stack's shared rejection for a missing permission.

A **View** folds events into a read model, keyed by what it is about. Private views list `middleware: [Session]` and authorize in `validate`.

A **Projection** writes outside the model through a port; a **Stream** is an ordered, readable log per key that a projection appends to.

A **Policy** reacts to events: "whenever X happens, do Y". It sends or schedules commands, runs at least once and has no session, so it acts as a system actor.

A **Saga** runs a long process with steps, waits and compensation. A policy starts it.

An **External System** is something outside the model a block calls, such as payments or email.

An **Api** (`Domain.Api`) lists the commands and reads a client may use, served over HTTP, MCP (`/Ai`) or a CLI. What it serves authorizes itself through middleware and `validate`.

## Who and what may

An **Actor** is who is acting: a **Person** (a signed-in user, possibly through an agent, `via: "agent"`) or a **System** actor (a named policy, saga or webhook). **CurrentActor** is the request context that carries it with each command to its aggregate.

A **Permission** is a `resource:action` string a block checks with **requirePermission**. A module publishes its strings as `<Module>Permissions`.

A **Role** is a name that grants permissions. **Roles** turns a principal's role names into permissions once per request; only permissions reach a model.

A **system grant** is the explicit permission list a system actor holds. It is an owner decision and never copies the roles of the person whose event caused the reaction.

An **AuthProvider** is the slot that answers who is signed in: it turns request headers into a **Principal** (`subject`, `orgId`, `roles`). `devTokens` fills it for tests and local play; Clerk or JWT providers fill it in production.

**Session** is the middleware a command or view lists to require a signed-in person. **SessionLive** implements it over an `AuthProvider` and `Roles`; with no principal it fails `Unauthenticated` (401).

**Object access** is who may touch one aggregate (owner, members, holders). It lives in the aggregate's state and is checked in `decide` after the permission, with its own rejection such as `NotAuthor`.

## The workspace

A **module** is a folder in `packages/stack/src/<module>/` with its blocks, its door (`index.ts`), its permissions, its README and its tests: comments, contacts, delivery, notes, notifications, organisations, projects, relations and work-items. An app **mounts** it by spreading its block lists into its own `Domain.Model`.

The **door** of a package is its `src/index.ts`. `@house-rules/stack` has exactly one; modules are namespace exports from it.

A **thin config** extends a house-rules preset and sets only project values: `tsconfig.base.json`, `biome.json`, `eslint.config.mjs`, `.dependency-cruiser.cjs`.

The **example** is `examples/booking`: a domain package and a server that hosts it on Postgres (or in memory) on Node and on Cloudflare Durable Objects. New projects remove it.

A **Story** (`@alchemy.run/domain/Story`) is a test written as given events, a command, and the events, reply or rejection that follow.
