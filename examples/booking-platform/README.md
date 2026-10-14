# Booking platform: the example

This folder is a private showcase. It is laid out like a regular project, with its own `apps/` and `packages/`:

```text
examples/booking-platform/
  apps/api/               @example/api          the reference app: delivery, use-cases, composition, web page
  packages/bookings/      @example/bookings     its domain module
  packages/dev-sign-in/   @example/dev-sign-in  dev and demos only: sign in by name
```

The app and its package show each part of the framework once. Read a row of the concept map, then open its file.

Nothing here is published. All three workspaces (`apps/api`, `packages/bookings` and `packages/dev-sign-in`) are `private`. The framework packages in the repository's `packages/` never import them: the `framework-does-not-import-examples` rule in [`.dependency-cruiser.cjs`](../../.dependency-cruiser.cjs) fails the check if one does. The root config lists `examples/*/apps` and `examples/*/packages` as roots, so the same rules check this code as any other app or package.

In a new project made from this template, delete `examples/`. Then remove its traces:

1. [ ] the two `examples/*` globs in `pnpm-workspace.yaml`;
2. [ ] the `examples/*` roots in `.dependency-cruiser.cjs` and `eslint.config.mjs`;
3. [ ] its line in `migrations.json`.

Your own code goes in `apps/` and `packages/`.

## Concept map

### Domain (the domain kit, `@house-rules/domain`)

| Concept | Where |
| --- | --- |
| Root module with `defineModule` | [`packages/bookings/src/facade.ts`](packages/bookings/src/facade.ts) |
| Storage port | [`packages/bookings/src/storage.ts`](packages/bookings/src/storage.ts) (`BookingStore`) |
| Memory and Postgres adapters | [`adapters/memory/`](packages/bookings/src/adapters/memory/memory-booking-store.ts), [`adapters/postgres/`](packages/bookings/src/adapters/postgres/postgres-booking-store.ts) |
| One shared store suite on both adapters | [`adapters/tests/booking-store.test.ts`](packages/bookings/src/adapters/tests/booking-store.test.ts) |
| Module-owned migrations, append-only | [`packages/bookings/migrations/`](packages/bookings/migrations/0003_booking_status.sql) (`0003` adds the status) |
| Actor and relation (`owner`, `none`) | `Bookings.relation` in [`facade.ts`](packages/bookings/src/facade.ts) asks `relationOf` in [`booking/booking-policy.ts`](packages/bookings/src/booking/booking-policy.ts) |
| `definePolicy` with object states (`active`, `cancelled`) | `bookingPolicy` in [`booking/booking-policy.ts`](packages/bookings/src/booking/booking-policy.ts); `Bookings.cancel` checks it |
| "Not yours" looks like "not found" | `Bookings.cancel` fails with `BookingNotFound` for `none` |
| A write joins the open unit of work | `Bookings.create` and `Bookings.cancel` call `UnitOfWork.required` |

### Application (the application kit, `@house-rules/application`)

| Concept | Where |
| --- | --- |
| Contracts, in the browser-safe contract entry | `show_booking`, `book_booking`, `cancel_booking` in [`booking/show-booking.ts`](packages/bookings/src/booking/show-booking.ts), [`book-booking.ts`](packages/bookings/src/booking/book-booking.ts), [`cancel-booking.ts`](packages/bookings/src/booking/cancel-booking.ts), exported by [`contract.ts`](packages/bookings/src/contract.ts) |
| `implement`, `transactional: true` | [`src/use-cases/book-booking.ts`](apps/api/src/use-cases/book-booking.ts), [`src/use-cases/cancel-booking.ts`](apps/api/src/use-cases/cancel-booking.ts) |
| `CurrentActor` | book, cancel, the four [comment use-cases](apps/api/src/use-cases/comments/) and [`show-person.ts`](apps/api/src/use-cases/show-person.ts) |
| Grant | the visitor Grant in [`src/composition/app-layer.ts`](apps/api/src/composition/app-layer.ts); the member and agent Grants in [`src/composition/callers.ts`](apps/api/src/composition/callers.ts) |
| Approval on a destructive contract | `cancel_booking` sets `needsApproval: true`; the lifecycle test grants and denies it |
| CallWatch | call-audit on the slot in [`src/composition/app-layer.ts`](apps/api/src/composition/app-layer.ts) |
| One API list, read by the server and the browser | `defineApi` in `src/delivery/http/api.ts`: contracts only |
| The server mounts it | `mount(api, { key: capability })` in [`src/delivery/http/routes.ts`](apps/api/src/delivery/http/routes.ts); `tsc` fails on a missing key |
| The browser calls it | `toPromiseClient(api, { token, onCall })` in `src/delivery/web/session.ts` |
| OpenAPI | `openApi` in [`src/main.ts`](apps/api/src/main.ts), from the mounted routes |
| A caller per adapter | `toFetchHandler(app, { caller: visitorCaller })` in [`src/main.ts`](apps/api/src/main.ts) for visitors and for dev sign-in; `agentCaller` on MCP |
| A second CallWatch around call-audit | `requestLogWatch` in `src/composition/request-log.ts` notes each call's capability, actor and outcome |
| MCP tools, fail closed | [`src/delivery/mcp/`](apps/api/src/delivery/mcp/route.ts); tests in [`src/delivery/mcp/tests/`](apps/api/src/delivery/mcp/tests/auth.test.ts) |
| `protectedResource`: RFC 9728 metadata and the `WWW-Authenticate` challenge | `mcpResourceOf` in [`src/delivery/mcp/config.ts`](apps/api/src/delivery/mcp/config.ts) |

### Wiring

| Concept | Where |
| --- | --- |
| Composition root | [`src/composition/`](apps/api/src/composition/index.ts): layer, caller, views |
| Memory or Postgres, picked once | `appLayer` in [`src/composition/app-layer.ts`](apps/api/src/composition/app-layer.ts), from `DATABASE_URL` |
| Sign-in picked once: visitors, a real issuer, or the dev issuer | `signInConfig` and `signInLayer` in [`src/composition/sign-in.ts`](apps/api/src/composition/sign-in.ts), from `AUTH_ISSUER`, `DEV_ISSUER` and `NODE_ENV` |
| One readable line per HTTP request | `logRequests` in `src/delivery/http/access-log.ts`, wrapped around the handler in `main.ts` |
| Migrations runner | [`src/main.ts`](apps/api/src/main.ts) runs `Migrations.script` on the root [`migrations.json`](../../migrations.json) before it serves |
| Host | `serve` from `@house-rules/node-host` in [`src/main.ts`](apps/api/src/main.ts) |
| The Postgres composition, proven | [`src/tests/postgres-composition.test.ts`](apps/api/src/tests/postgres-composition.test.ts) |

### Additions

| Concept | Where |
| --- | --- |
| Comments, a domain addition, with its host port filled from `Bookings.relation` | `commentTargets` in [`src/composition/app-layer.ts`](apps/api/src/composition/app-layer.ts) |
| call-audit, a plug-in on `CallWatch` (`agentAware` preset) | `auditOptions` in [`src/composition/app-layer.ts`](apps/api/src/composition/app-layer.ts) |
| auth-jwt, a plug-in on `Authenticator`: checks the token's signature, `iss`, `exp` and `aud` | `AuthJwt.layer` in `signInLayer`, [`src/composition/sign-in.ts`](apps/api/src/composition/sign-in.ts) |
| identity: a login (`iss`, `sub`) bound to an `ActorId`, and `Identity.caller` | `Identity.layerMemory` / `layerPostgres` in [`app-layer.ts`](apps/api/src/composition/app-layer.ts); `memberCaller` and `agentCaller` in [`callers.ts`](apps/api/src/composition/callers.ts) |
| party, a domain addition: the Person is the actor | `Party.layerMemory` / `layerPostgres` in [`app-layer.ts`](apps/api/src/composition/app-layer.ts); `show_person` in [`show-person.ts`](apps/api/src/use-cases/show-person.ts) |
| auth-jwt's local issuer, dev and demos only | `AuthJwtLocal.layer()` in `signInLayer` when `DEV_ISSUER=1`; `DevSignIn` in `packages/dev-sign-in/src/facade.ts` turns a name into a stable `sub` and a token |
| `show_me`, the signed-in Person | its contract sits in `@example/dev-sign-in`'s contract entry, `packages/dev-sign-in/src/me/show-me.ts`, for now; its home is `@house-rules/party` (see `TODO.md`) |
| `FirstSignIn` filled by the app: create a Person, bind the login, in one unit; never by email | `createPersonOnFirstSignIn` in [`src/composition/sign-in.ts`](apps/api/src/composition/sign-in.ts); tests in [`src/tests/sign-in.test.ts`](apps/api/src/tests/sign-in.test.ts) |

## Run modes

| `DATABASE_URL` | Stores | Unit of work | Audit |
| --- | --- | --- | --- |
| empty | memory, seeded with one booking, `demo` | `memoryUnitOfWork` | memory |
| set | Postgres | `sqlUnitOfWork` | the `call_audit` table |

| `AUTH_ISSUER` | `DEV_ISSUER` | Web API | `FirstSignIn` |
| --- | --- | --- | --- |
| empty | empty | visitors read `GET /api/bookings/:id`; no actor route is mounted | `Identity.refuse`, and every token is refused |
| set | empty | every route needs `Authorization: Bearer <token>` from that issuer | a new Person, named from the `name` claim |
| empty | `1` | the same routes, with tokens from the local issuer; `POST /api/dev/sign-in` hands them out | a new Person, named from the `name` claim |
| set | `1` | refuses to start | |

`DEV_ISSUER=1` with `NODE_ENV=production` refuses to start too: whoever reaches the dev issuer can sign in as anyone. With `DEV_ISSUER` off, `POST /api/dev/sign-in` answers 404 `not_found`.

`AUTH_AUDIENCE`, when set, is the `aud` a web token must carry.

## Run it

Build once, then start. `start` runs through varlock, so it reads `.env.schema` and your `.env.local`.

```sh
pnpm --filter @example/api build
PORT=3000 pnpm --filter @example/api start
```

`build` runs two steps. `build:web` builds the page with Vite into `apps/api/dist/web`. `build:api` bundles `apps/api/src/main.ts` and the workspace packages into `apps/api/dist/main.js` with esbuild. Effect stays external and loads from `node_modules`. When `dist/web` sits beside the bundle, `start` serves the page too; see [One service](#one-service).

For Postgres, start the server and point `DATABASE_URL` at it. The app runs every module's migrations before it serves:

```sh
docker compose up -d
DATABASE_URL=postgres://house_rules:house_rules@127.0.0.1:55435/house_rules pnpm --filter @example/api start
```

The Postgres database starts empty, so `demo` is a 404 there. Then try:

```sh
curl -i localhost:3000/api/bookings/demo   # 200 in memory mode, AUTH_ISSUER empty
curl -i localhost:3000/api/bookings/nobody # 404 not_found
curl -i -X POST localhost:3000/mcp         # 503 not_configured
```

The OpenAPI document is `openApi` in [`src/main.ts`](apps/api/src/main.ts). No route serves it yet; [`src/tests/main.test.ts`](apps/api/src/tests/main.test.ts) reads it.

## Signed-in routes

With `AUTH_ISSUER` or `DEV_ISSUER=1` set, `main.ts` mounts `memberRoutes` from [`src/delivery/http/routes.ts`](apps/api/src/delivery/http/routes.ts) on the composition's own caller, `webCaller`. It is `memberCaller`: `Identity.caller` with a bearer token and the member Grant (`bookings:read`, `bookings:write`, `comments:read`, `comments:write`, `party:read`).

The routes come from the API list in `src/delivery/http/api.ts`. Each key is one endpoint. The server mounts a capability on it, and the web page calls it by the same key.

| Key | Route | Capability |
| --- | --- | --- |
| `showBooking` | `GET /api/bookings/:id` | `show_booking` |
| `bookBooking` | `POST /api/bookings` (201) | `book_booking` |
| `listComments`, `addComment`, `editComment`, `removeComment` | `POST /api/list_comments`, `/add_comment`, `/edit_comment`, `/remove_comment` | the four comment use-cases |
| `showPerson` | `GET /api/people/:id` | `show_person`, from `@house-rules/party/contract` |
| `showMe` | `GET /api/me` | `show_me`: the signed-in Person |
| `devApi.signIn` | `POST /api/dev/sign-in` | `dev_sign_in`, on its own handler with no token |

Visitors get `visitorApi`, the one key `showBooking`. Dev sign-in sits in its own list, `devApi`, because one fetch handler has one caller, and this route runs before there is a token.

The first request with a new login runs `FirstSignIn`: one unit creates the Person and binds `(iss, sub)` to its id. Later requests resolve the binding. `cancel_booking` stays off HTTP: it sets `needsApproval: true`, and HTTP fills Approval with `denyAll`, so every call would be refused. It waits for a real confirm step.

## Click through it

The web page lives in the API app, in `src/delivery/web/`, because it reads the same API list as the server. Vite serves it on port 5173 and passes `/api` to the API on port 3000, so the page and the API share one origin.

Start both, from the repository root:

```sh
pnpm --filter @example/api dev
```

`dev` runs two scripts side by side. Run them in two terminals if you want the logs apart:

```sh
pnpm --filter @example/api dev:api   # builds, then serves with DEV_ISSUER=1 in memory mode
pnpm --filter @example/api dev:web   # Vite on http://localhost:5173
```

Open <http://localhost:5173>. The page's request log, on the right, shows each call it makes, newest first. The API terminal prints one line per request: time, method, path, status, ms, `capability:outcome`, actor and the first 8 characters of the request id.

1. [ ] **Sign in as Alice.** Keep the name `Alice` and press Sign in. The page logs `POST /api/dev/sign-in 200`, then `GET /api/me 200`. The API logs `First sign-in: Person <id> created for dev:alice`, then:

   ```text
   21:22:27.961 GET  /api/me 200 7ms show_me:ok actor=05e3a7d8f6d8ca2270c337007111ee0e req=ad922068
   ```

   The page shows `Signed in as Alice` and her Person id, the same id as `actor=`.
2. [ ] **Book.** Keep `b-1` and `Ada`, press Book. The page logs `POST /api/bookings 201` and says `Booked b-1 for Ada: active.` The API logs `book_booking:ok` with Alice's id.
3. [ ] **Open it and comment.** Press Open, then Add comment. Open logs `GET /api/bookings/b-1 200` and then `POST /api/list_comments 200`, because opening a booking also lists its comments; the API logs the `list_comments` call too. Add comment then logs `POST /api/add_comment 200` and a second `POST /api/list_comments 200`, the later list. The comment shows `you` and its id. Copy the id.
4. [ ] **Sign in as Bob.** Press Sign out, type `Bob`, press Sign in. The API logs a second `First sign-in`, with a new Person id. Sign in as `Alice` again later, and it is the old id: the same name is the same `sub`, `dev:alice`.
5. [ ] **Try to edit Alice's comment.** Paste the id into "Edit a comment by id" and press Edit. The page shows `404 not_found: Comment target was not found.` and logs `POST /api/edit_comment 404 not_found`. The API logs:

   ```text
   21:22:41.871 POST /api/edit_comment 404 4ms edit_comment:CommentTargetNotFound actor=dd35364c13d7412d59b81e3acb7f624b req=4d80622a
   ```

   Bob can open `b-1`, because bookings are readable, but its comments look missing to him: `POST /api/list_comments 404`. Not yours looks like not found.

Restart `dev:api` and everything is gone: memory mode keeps nothing, and the dev issuer makes a new key pair, so old tokens stop working. Sign in again.

### One service

This is how the page ships. Build the page and the API, then start one Node process:

```sh
pnpm --filter @example/api build
DEV_ISSUER=1 pnpm --filter @example/api start
```

Open <http://localhost:3000>. The page and `/api` share one origin, with no proxy, so the client in `src/delivery/web/session.ts` needs no `baseUrl` and the API needs no CORS. `main.ts` puts `staticFiles` from `@house-rules/node-host` in front of the API:

```ts
const site = staticFiles({ root, exclude: ["/api", "/mcp", "/.well-known"] });
const handler = (request) => site(request).then((response) => response ?? api(request));
```

`root` is `WEB_ROOT` when set, else `dist/web` beside `dist/main.js`. With neither, `start` serves the API only, as before. The start line says which: `page from <folder>` or `API only`. Paths under `/api`, `/mcp` and `/.well-known` always reach the API, even when a browser asks for HTML. `/bookings/b-1` gets `index.html`, a hashed file under `/assets/` is cached for a year, and `/.env` is a 404. The access log prints page requests too, with `-` for the capability.

`dev:api` runs only `build:api`, so it never rebuilds the page. A `dist/web` left by an earlier `build` is served on port 3000 as it was; use port 5173 while you change the page.

### A page on another origin

The second option, not built here: a separate web app or a CDN serves the page, and the API runs on its own origin. Mount the API with an allow-list, and give the client the API's origin:

```ts
// main.ts
toFetchHandler(app, { routes: memberRoutes, cors: { origins: ["https://web.example"] } });

// the page
const member = toPromiseClient(api, { baseUrl: "https://api.example", token });
```

The client sends the token as a header, so no cookie crosses origins. CORS only says which pages may read the answers; it is not access control. See the application kit's [CORS section](../../packages/application/README.md#cors).

## MCP

`POST /mcp` serves two read-only tools, `show_booking` and `list_comments`. Its caller is `agentCaller` in [`src/composition/callers.ts`](apps/api/src/composition/callers.ts): `Identity.caller` with the MCP resource as the audience, the read-only agent Grant, and the challenge from `protectedResource`. A person who signs in on the web and over MCP is the same actor.

1. [ ] `APP_ORIGIN` or `AUTH_ISSUER` empty: `/mcp` answers 503 `not_configured` with no challenge, and the metadata paths answer GET and HEAD with 503 `not_configured` and other methods with 405, because there is no authorization server to name. This is the fail-closed case in `AGENTS.md`.
2. [ ] Both set: no token gets 401 with `WWW-Authenticate: Bearer resource_metadata="…"`, and a token that is bad, expired, or not issued for `<APP_ORIGIN>/mcp` gets 401 `invalid_token`.

`/.well-known/oauth-protected-resource` (and `…/mcp`) names `<APP_ORIGIN>/mcp` as the resource and `AUTH_ISSUER` as the authorization server. Write tools wait for owner approval, by name.
