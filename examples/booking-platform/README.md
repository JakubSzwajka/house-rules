# Booking platform: the example

This folder is a private showcase. It is laid out like a regular project, with its own `apps/` and `packages/`:

```text
examples/booking-platform/
  apps/api/               @example/api          the reference app: delivery, use-cases, composition, web page
  packages/bookings/      @example/bookings     its domain module
  packages/accounts/      @example/accounts     email and password accounts: the app's own sign-in
  packages/activity/      @example/activity     your audit trail: your own calls, read from call-audit
```

The app and its package show each part of the framework once. Read a row of the concept map, then open its file.

Nothing here is published. All four workspaces (`apps/api`, `packages/bookings`, `packages/accounts` and `packages/activity`) are `private`. The framework packages in the repository's `packages/` never import them: the `framework-does-not-import-examples` rule in [`.dependency-cruiser.cjs`](../../.dependency-cruiser.cjs) fails the check if one does. The root config lists `examples/*/apps` and `examples/*/packages` as roots, so the same rules check this code as any other app or package.

In a new project made from this template, delete `examples/`. Then remove its traces:

1. [ ] the two `examples/*` globs in `pnpm-workspace.yaml`;
2. [ ] the `examples/*` roots in `.dependency-cruiser.cjs` and `eslint.config.mjs`;
3. [ ] its lines in `migrations.json`.

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
| A read for one actor, filtered by the owner fact | `Bookings.listMine` and `BookingStore.listByOwner`; `0004` adds the index |

### Application (the application kit, `@house-rules/application`)

| Concept | Where |
| --- | --- |
| Contracts, in the browser-safe contract entry | `show_booking`, `book_booking`, `cancel_booking` in [`booking/show-booking.ts`](packages/bookings/src/booking/show-booking.ts), [`book-booking.ts`](packages/bookings/src/booking/book-booking.ts), [`cancel-booking.ts`](packages/bookings/src/booking/cancel-booking.ts), exported by [`contract.ts`](packages/bookings/src/contract.ts) |
| `implement`, `transactional: true` | [`src/use-cases/book-booking.ts`](apps/api/src/use-cases/book-booking.ts), [`src/use-cases/cancel-booking.ts`](apps/api/src/use-cases/cancel-booking.ts) |
| `CurrentActor` | book, cancel, the four [comment use-cases](apps/api/src/use-cases/comments/), show and rename a Person, change password, my bookings, your audit trail |
| Grant | the member and agent Grants in [`src/composition/callers.ts`](apps/api/src/composition/callers.ts) |
| A non-transactional use-case that commits, then fails | `sign_in` and `change_password` in `src/use-cases/accounts/`: a refused password still counts toward the lock |
| Approval on a destructive contract | `cancel_booking` sets `needsApproval: true`; the lifecycle test grants and denies it |
| CallWatch | call-audit on the slot in [`src/composition/app-layer.ts`](apps/api/src/composition/app-layer.ts) |
| One API list, read by the server and the browser | `defineApi` in `src/delivery/http/api.ts`: contracts only |
| The server mounts it | `mount(api, { key: capability })` in [`src/delivery/http/routes.ts`](apps/api/src/delivery/http/routes.ts); `tsc` fails on a missing key |
| The browser calls it | `toPromiseClient(api, { onCall })` in `src/delivery/web/session.ts`: same origin, so the browser sends the session cookie itself. `onCall` only tells the audit dock to ask the server again |
| OpenAPI | `openApi` in [`src/main.ts`](apps/api/src/main.ts), from the mounted routes |
| A caller per adapter | `toFetchHandler(app, { caller: visitorCaller })` in [`src/main.ts`](apps/api/src/main.ts) for sign-up and sign-in; the member caller for the rest; `agentCaller` on MCP |
| A second CallWatch around call-audit | `requestLogWatch` in `src/composition/request-log.ts` notes each call's capability, actor and outcome |
| MCP tools, fail closed | [`src/delivery/mcp/`](apps/api/src/delivery/mcp/route.ts); tests in [`src/delivery/mcp/tests/`](apps/api/src/delivery/mcp/tests/auth.test.ts) |
| `protectedResource`: RFC 9728 metadata and the `WWW-Authenticate` challenge | `mcpResourceOf` in [`src/delivery/mcp/config.ts`](apps/api/src/delivery/mcp/config.ts) |

### Wiring

| Concept | Where |
| --- | --- |
| Composition root | [`src/composition/`](apps/api/src/composition/index.ts): layer, caller, views |
| Memory or Postgres, picked once | `appLayer` in [`src/composition/app-layer.ts`](apps/api/src/composition/app-layer.ts), from `DATABASE_URL` |
| Sign-in set up once | `signInConfig` and `signInLayer` in [`src/composition/sign-in.ts`](apps/api/src/composition/sign-in.ts), from `ACCOUNTS_SIGNING_KEY`, `ACCOUNTS_ISSUER`, `APP_ORIGIN`, `PORT`, `NODE_ENV` and `MCP_AUTH_ISSUER` |
| One readable line per HTTP request | `logRequests` in `src/delivery/http/access-log.ts`, wrapped around the handler in `main.ts` |
| Migrations runner | [`src/main.ts`](apps/api/src/main.ts) runs `Migrations.script` on the root [`migrations.json`](../../migrations.json) before it serves |
| Host | `serve` from `@house-rules/node-host` in [`src/main.ts`](apps/api/src/main.ts) |
| The Postgres composition, proven | [`src/tests/postgres-composition.test.ts`](apps/api/src/tests/postgres-composition.test.ts) |

### Additions

| Concept | Where |
| --- | --- |
| Comments, a domain addition, with its host port filled from `Bookings.relation` | `commentTargets` in [`src/composition/app-layer.ts`](apps/api/src/composition/app-layer.ts) |
| call-audit, a plug-in on `CallWatch` (`strict` preset: every call, reads too) | `auditOptions` in [`src/composition/app-layer.ts`](apps/api/src/composition/app-layer.ts) |
| accounts, the app's own identity provider: email and password, ES256 tokens | `Accounts.layerMemory` / `layerPostgres` and `AccountsIssuer` in `signInLayer`; `packages/accounts/README.md` |
| auth-jwt, a plug-in on `Authenticator`: checks the token's signature, `iss`, `exp` and `aud` | `AuthJwt.layer({ issuer, jwks })` over the accounts' public keys in `signInLayer`; a second one for MCP in `mcp-authenticator.ts` |
| identity: a login (`iss`, `sub`) bound to an `ActorId`, and `Identity.caller` | `Identity.layerMemory` / `layerPostgres` in [`app-layer.ts`](apps/api/src/composition/app-layer.ts); `memberCaller` and `agentCaller` in [`callers.ts`](apps/api/src/composition/callers.ts) |
| party, a domain addition: the Person is the actor | `Party.layerMemory` / `layerPostgres` in [`app-layer.ts`](apps/api/src/composition/app-layer.ts); `show_person`, `show_me` and `rename_person` from `@house-rules/party/contract` in [`src/use-cases/`](apps/api/src/use-cases/show-me.ts) |
| call-audit read back for one actor | `Activity` in `packages/activity/src/facade.ts` reads the newest 1000 rows with `AuditStore.read({ viewerId, limit })`, in memory and Postgres, and pages them 20 at a time; `list_my_activity` in `src/use-cases/list-my-activity.ts` |
| `FirstSignIn` filled by the app: create a Person, bind the login, in one unit; never by email | `createPersonOnFirstSignIn` in [`src/composition/sign-in.ts`](apps/api/src/composition/sign-in.ts); tests in [`src/tests/sign-in.test.ts`](apps/api/src/tests/sign-in.test.ts) |

## Run modes

| `DATABASE_URL` | Stores | Unit of work | Audit and your audit trail |
| --- | --- | --- | --- |
| empty | memory, seeded with one booking, `demo` | `memoryUnitOfWork` | the memory audit store |
| set | Postgres | `sqlUnitOfWork` | the `call_audit` table |

Sign-in is always the app's own: email and password accounts from `@example/accounts`. The app signs its own tokens, and `AuthJwt.layer` checks them against the accounts' public keys. There is no visitor mode: every route but sign-up, sign-in, sign-out and `POST /api/token` needs a session. The page's session is an HttpOnly cookie, `booking_session`, that sign-up and sign-in set; the page never holds the token. A script has no cookie, so it gets a token from `POST /api/token` and sends `Authorization: Bearer <token>`.

| `ACCOUNTS_SIGNING_KEY` | `NODE_ENV` | Tokens |
| --- | --- | --- |
| empty | not `production` | signed with a temporary key; the start logs a warning, and every token dies on restart |
| empty | `production` | the API refuses to start and says how to make a key |
| a private EC P-256 JWK, in `.env.local` | any | signed with that key; they survive a restart until they expire (1 hour) |

`ACCOUNTS_ISSUER` is the tokens' `iss`. Empty, it is the origin of `APP_ORIGIN`, or `http://localhost:<PORT>`. Make a key with:

```sh
node -e "crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign']).then(k=>crypto.subtle.exportKey('jwk',k.privateKey)).then(j=>console.log(JSON.stringify(j)))"
```

Put the output in `.env.local` as `ACCOUNTS_SIGNING_KEY='<json>'`. Git ignores that file. `.env.schema` marks the variable `@sensitive`, and the app reads it as a `Redacted` value.

## Run it

Build once, then start. `start` runs through varlock, so it reads `.env.schema` and your `.env.local`.

```sh
pnpm --filter @example/api build
PORT=3000 pnpm --filter @example/api start
```

`build` runs two steps. `build:web` builds the page with Vite into `apps/api/dist/web`. `build:api` bundles `apps/api/src/main.ts` and the workspace packages into `apps/api/dist/main.js` with esbuild. Effect stays external and loads from `node_modules`. When `dist/web` sits beside the bundle, `start` serves the page too; see [One service](#one-service).

Then sign up, sign in and call the API:

```sh
curl -s -X POST localhost:3000/api/sign-up -H 'content-type: application/json' \
  -d '{"email":"alice@example.test","password":"a long enough secret","displayName":"Alice"}'
TOKEN=$(curl -s -X POST localhost:3000/api/token -H 'content-type: application/json' \
  -d '{"email":"alice@example.test","password":"a long enough secret"}' | node -pe 'JSON.parse(require("fs").readFileSync(0)).token')
curl -s localhost:3000/api/me -H "authorization: Bearer $TOKEN"          # 200, your Person
curl -s localhost:3000/api/bookings/demo -H "authorization: Bearer $TOKEN" # 200 in memory mode
curl -i localhost:3000/api/bookings/demo                                   # 401 token_missing
curl -i -X POST localhost:3000/mcp                                         # 503 not_configured
```

The OpenAPI document is `openApi` in [`src/main.ts`](apps/api/src/main.ts). No route serves it yet; [`src/tests/main.test.ts`](apps/api/src/tests/main.test.ts) reads it.

## Routes

`main.ts` mounts two API lists from [`src/delivery/http/api.ts`](apps/api/src/delivery/http/api.ts), each on its own fetch handler, because one handler has one caller. Each key is one endpoint. The server mounts a capability on it in [`src/delivery/http/routes.ts`](apps/api/src/delivery/http/routes.ts), and the web page calls it by the same key.

`publicApi` runs before there is a token, on `visitorCaller`: no actor, and only `public` contracts.

| Key | Route | Capability |
| --- | --- | --- |
| `signUp` | `POST /api/sign-up` (201) | `sign_up`: an account, credentials only |
| `signIn` | `POST /api/sign-in` | `sign_in`: sets the `booking_session` cookie (HttpOnly) and answers `{ expiresAt, name }`, no token |
| `signOut` | `POST /api/sign-out` | `sign_out`: clears the cookie |
| `tokenApi.signIn` | `POST /api/token` | `sign_in` again, for scripts: answers the bearer token `{ token, expiresAt }`, sets no cookie |

`api` runs on the composition's own caller, `webCaller`. It is `memberCaller`: `Identity.caller` with a bearer token and the member Grant (`bookings:read`, `bookings:write`, `comments:read`, `comments:write`, `party:read`, `party:update`, `accounts:update`, `activity:read`).

| Key | Route | Capability |
| --- | --- | --- |
| `showBooking` | `GET /api/bookings/:id` | `show_booking` |
| `bookBooking` | `POST /api/bookings` (201) | `book_booking` |
| `listMyBookings` | `GET /api/my/bookings` | `list_my_bookings`: your bookings, by id, at most 100 |
| `listComments`, `addComment`, `editComment`, `removeComment` | `POST /api/list_comments`, `/add_comment`, `/edit_comment`, `/remove_comment` | the four comment use-cases |
| `showPerson` | `GET /api/people/:id` | `show_person`, from `@house-rules/party/contract` |
| `showMe` | `GET /api/me` | `show_me`: the signed-in Person |
| `renamePerson` | `POST /api/me/name` | `rename_person`: only yourself |
| `changePassword` | `POST /api/me/password` | `change_password`: needs the current password |
| `listMyActivity` | `GET /api/my/activity` | `list_my_activity`: your own calls call-audit kept, newest first, 20 at a time. pass the page's `next` back as `?beforeAt=<ms>&skipAtSameTime=<n>` for the next 20. Its own reads stay out unless `?includeActivityReads=true` |

The first signed-in call runs `FirstSignIn`: one unit creates the Person, named from the token's `name` claim (the display name from sign-up), and binds `(iss, sub)` to its id. Later calls resolve the binding. The account is credentials only; the Person is the profile. Email never links identities.

A wrong password, an unknown email and a locked account all answer 401 `invalid_credentials`, so no answer says an email exists. Five wrong passwords lock the account for 15 minutes. `sign_in` and `change_password` commit the failure count before they fail, so a refusal still counts. A password change does not revoke tokens: an old one works until it expires.

Your audit trail shows what call-audit's `strict` policy keeps: every call, reads and writes, with its outcome, kind, channel, target id, duration and request id. It shows only this account's calls: MCP logins are a separate Person, so their calls are not here. Sign-up and sign-in run before you are anyone, so the audit keeps them with no actor and they never show.

Paging uses a cursor. Each page returns `next`: the last entry's `recordedAt` as `beforeAt`, and `skipAtSameTime`, how many rows at exactly that millisecond were already shown. Rows sort newest first, then by every other field, so calls in the same millisecond keep one order and none is lost or shown twice, even with no request id or a repeated one. Pass both fields or neither; a lone one, a negative one or one out of range is a 400. `list_my_activity` rows are left out before paging unless `includeActivityReads` is true, so every page still holds 20. The store keeps them either way. `AuditStore.read` has no `before` filter yet, so `Activity` reads your newest 1000 rows and applies the cursor itself. Past those, `moreBeyondWindow` is true and the dock says the list reaches no further. The server still keeps the older rows.

`cancel_booking` stays off HTTP: it sets `needsApproval: true`, and HTTP fills Approval with `denyAll`, so every call would be refused. It waits for a real confirm step.

## Click through it

The web page lives in the API app, in `src/delivery/web/`, because it reads the same API lists as the server. Vite serves it on port 5173 and passes `/api` to the API on port 3000, so the page and the API share one origin.

### Memory mode

Start both, from the repository root:

```sh
pnpm --filter @example/api dev
```

`dev` runs two scripts side by side. Run them in two terminals if you want the logs apart:

```sh
pnpm --filter @example/api dev:api   # builds, then serves in memory mode
pnpm --filter @example/api dev:web   # Vite on http://localhost:5173
```

With no `ACCOUNTS_SIGNING_KEY`, the API logs a warning that it signs with a temporary key. Open <http://localhost:5173>. The API terminal prints one line per request: time, method, path, status, ms, `capability:outcome`, actor and the first 8 characters of the request id. The dark bar docked at the bottom is "Your audit trail": what the server's audit kept for you, read from `GET /api/my/activity`. Click it or press Ctrl+` to open it. Each row shows the time, capability, outcome, kind, channel, target id, duration and request id; click one to see all its fields. Its request id is the one the API terminal prints. The page keeps no log of its own: it asks the server on load, again just after each call it makes, and when you press refresh. Each time the dock reads the trail, call-audit keeps that read as a `list_my_activity` row. The dock hides those rows; Include audit reads shows them, and the page remembers the choice. It is a demo window onto the framework, not part of a real booking app.

1. [ ] **Sign up as Alice.** On the Sign up tab, type `Alice`, `alice@example.test` and a password of 10 or more characters, and press Create account. Sign-up signs her in: the API terminal shows `POST /api/sign-up 201`, then `GET /api/me 200`, with no second sign-in call, and the page holds no token. The audit trail lists `show_me` but not `sign_up`, which ran before she was anyone. The browser keeps an HttpOnly `booking_session` cookie, which page scripts cannot read. Reload the page and she is still signed in: the page asks `GET /api/me` and the cookie answers. The API logs `First sign-in: Person <id> created for <account id>`. The header shows `Alice`, and the id in `actor=` in the API log is her Person id.
2. [ ] **Try the wrong password.** Open the menu under your name and press Sign out. Sign in with a wrong password: a red alert shows `401 invalid_credentials` and the message. An unknown email gets the same answer. Sign up again with Alice's email: `409 taken`. Sign in with the right password.
3. [ ] **Rename yourself.** Menu, Rename, type `Alice L.`, Save. The audit trail lists `rename_person` as a write, and the header shows the new name.
4. [ ] **Change your password.** Menu, Change password, type the current one and a new one of 10 or more characters. Sign out, and the old password now gets `401 invalid_credentials`; the new one signs you in.
5. [ ] **Book.** Under New booking, type `Ada` and press Book. The audit trail lists `book_booking` with the booking's id as its target, and My bookings lists Ada as Active. The page made the booking's id, `b-` and 32 hex digits; no field asks for one.
6. [ ] **Open it and comment.** Press Ada in My bookings. A sheet opens with the guest, the status and the comments, and the audit trail lists `show_booking` and `list_comments` as reads. Type a comment and press Add. It shows `You` and the time.
7. [ ] **Edit and remove it.** Press the pencil on your comment, change the text, press Save: `POST /api/edit_comment 200`, and the byline says `edited`. The bin removes it. Only your own comments have these buttons.
8. [ ] **Read your audit trail.** Open the dock. It lists every call you made, newest first: `remove_comment`, `edit_comment`, `add_comment`, the reads around them, `book_booking`, `change_password`, `rename_person` and `show_me`. A failure shows in red. Reload the page: the trail is still there, because the server keeps it. With more than 20 calls, Load older at the bottom shows the next 20. Press Include audit reads to see the dock's own `list_my_activity` reads too.
9. [ ] **Sign up as Bob.** Sign out, sign up as `Bob` with `bob@example.test`. The API logs a second `First sign-in`, with a new Person id. Bob's My bookings is empty, and his audit trail holds only his own calls.

The page never asks for an id, so it gives Bob no way to reach Alice's booking or comment. The API refuses him anyway: [`src/tests/sign-in.test.ts`](apps/api/src/tests/sign-in.test.ts) signs in as both and checks that Bob's `edit_comment` on Alice's comment fails with `404 not_found`. Not yours looks like not found.

Restart `dev:api` and everything is gone: memory mode keeps nothing, and the temporary key is new, so the old cookie gets `401 token_invalid`, and a reload shows the sign-in card. Sign up again.

### Postgres mode

Postgres and a fixed key keep accounts, people, bookings and activity across restarts.

1. [ ] Start Postgres: `docker compose up -d`.
2. [ ] Make a key with the command in [Run modes](#run-modes), and put it in the repository root's `.env.local`:

   ```sh
   ACCOUNTS_SIGNING_KEY='{"key_ops":["sign"],"ext":true,"kty":"EC","x":"…","y":"…","crv":"P-256","d":"…"}'
   ```

3. [ ] Build and start against the database. The app runs every module's migrations before it serves, and the start line has no temporary-key warning:

   ```sh
   pnpm --filter @example/api build
   DATABASE_URL=postgres://house_rules:house_rules@127.0.0.1:55435/house_rules pnpm --filter @example/api start
   ```

4. [ ] Open <http://localhost:3000>. The database starts empty, so `demo` is a 404 here. Sign up, book a stay for `Ada`, add a comment.
5. [ ] Stop the server with Ctrl-C and start it again with the same command. The page holds no token. Its cookie is still valid, because the key is fixed, so reload the page: you are still signed in, and the refresh button on My bookings works. Sign out and sign in again: it works, and My bookings and the audit trail still list what you did.

[`src/tests/postgres-composition.test.ts`](apps/api/src/tests/postgres-composition.test.ts) proves the same on a throwaway database: an account signed up in one composition signs in from the next, and its old token still checks.

### One service

This is how the page ships. Build the page and the API, then start one Node process:

```sh
pnpm --filter @example/api build
pnpm --filter @example/api start
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

## The page

The page is React on stock [shadcn/ui](https://ui.shadcn.com): the new-york style, the neutral base colour, CSS variables, and Tailwind v4.

| Piece | Where |
| --- | --- |
| Screens | `apps/api/src/delivery/web/*.tsx`: the sign-in card, the header menu, New booking, My bookings, the booking sheet, the audit dock (`audit-dock.tsx`) |
| Components from the shadcn CLI | `apps/api/src/delivery/web/components/ui/` |
| `cn`, the class-name helper | `apps/api/src/delivery/web/components/class-names.ts` |
| Theme: tokens, dark variant, base layer | `apps/api/src/delivery/web/styles.css` |
| CLI settings and aliases | `apps/api/components.json` |
| Build | `vite.config.ts` runs the React plugin and `@tailwindcss/vite` |

The layout rules shape two things. App code lives only under `src/delivery`, `src/server`, `src/use-cases` and `src/composition`, so the components sit in `src/delivery/web/components/ui/`, not `src/components/ui/`. No file may be called `utils`, so `cn` lives in `class-names.ts`, and `components.json` points its `utils` alias there.

The theme is shadcn's stock stylesheet with one change: `@custom-variant dark` uses the block form, because `@eslint/css` cannot parse the one-line form. It means the same thing. The stock `@import "shadcn/tailwind.css"` is left out; the new-york components do not use it, and it would add the `shadcn` package.

### What guards it

`eslint.config.mjs` turns on two presets from `@house-rules/rules` for `examples/booking-platform/apps/*`, both at their defaults:

- `shadcn()` runs `@shadcn/lint` on every `.tsx` file there. It rejects palette colours such as `bg-red-500`, arbitrary values such as `text-[13px]`, inline styles, dynamic class strings, spacing classes on a component that owns its spacing, and a raw `<button>`, `<input>` or `<table>` where `components/ui/` has the component. The component folder may restyle itself; raw colours stay banned there too.
- `design()` reads `styles.css` as the token file. It rejects raw colours and unknown `var()` tokens in the app's CSS, and colour literals such as `"#fff"` in its TypeScript.

`pnpm check` runs ESLint with `--max-warnings 0`, so any finding fails it. `src/tests/design-checks.test.ts` lints a probe through the real config. It also checks that the shadcn plugin can read the Button's sizes. The plugin parses components with `oxc-parser`, and falls back to `@typescript-eslint/parser` (the rules package resolves it on TypeScript 6.0.3) when oxc is missing. The assertion fails only when both parsers are unavailable. CI runs `pnpm --filter @example/api build:web` after the tests, so a page that does not build fails CI.

### Add a shadcn component

The CLI is pinned at `shadcn@4.21.4`. It cannot write into this app as it is, because the app's `tsconfig.json` has no `@/` path alias and its imports end in `.js`. So generate the file in a scratch folder and copy it in.

1. [ ] See what the component brings: from `examples/booking-platform/apps/api`, run `pnpm dlx shadcn@4.21.4 add <name> --dry-run`. Ignore the `cn` dependency it lists.
2. [ ] In an empty folder outside the repository, copy `components.json`, write a `package.json` with `"type": "module"`, a `tsconfig.json` with `"paths": { "@/*": ["./src/*"] }`, and `src/delivery/web/components/class-names.ts`. Run `pnpm dlx shadcn@4.21.4 add <name> --yes` there.
3. [ ] Copy the new file into `src/delivery/web/components/ui/`. Change `import { cn } from "cn"` to `import { cn } from "../class-names.js"`, and each `@/delivery/web/components/ui/<x>` import to `./<x>.js`. Change nothing else.
4. [ ] Add any new package with an exact pin: `pnpm --filter @example/api add -D <package>@<version>`. The install policy refuses a version younger than one day.
5. [ ] Run `pnpm exec biome format --write examples/booking-platform/apps/api`, then `pnpm check`.

## MCP

`POST /mcp` serves two read-only tools, `show_booking` and `list_comments`. Its caller is `agentCaller` in [`src/composition/callers.ts`](apps/api/src/composition/callers.ts): `Identity.caller` with the MCP resource as the audience, the read-only agent Grant, and the challenge from `protectedResource`.

MCP clients get their tokens from an external OAuth authorization server, `MCP_AUTH_ISSUER`. The app's own accounts have no OAuth endpoints, so they never serve MCP. `agentCaller` checks MCP tokens with their own `Authenticator`, `McpAuthenticator` in `src/composition/mcp-authenticator.ts`, and the web keeps the accounts' one. A token from one never passes the other.

A person who signs in through the accounts and through the MCP authorization server is two identities, two Persons: Identity binds each `(issuer, subject)` pair on its own and never links by email. Linking two logins to one Person is a later feature.

1. [ ] `APP_ORIGIN` or `MCP_AUTH_ISSUER` empty: `/mcp` answers 503 `not_configured` with no challenge, and the metadata paths answer GET and HEAD with 503 `not_configured` and other methods with 405, because there is no authorization server to name. This is the fail-closed case in `AGENTS.md`.
2. [ ] Both set: no token gets 401 with `WWW-Authenticate: Bearer resource_metadata="…"`, and a token that is bad, expired, from another issuer, or not issued for `<APP_ORIGIN>/mcp` gets 401 `invalid_token`.

`/.well-known/oauth-protected-resource` (and `…/mcp`) names `<APP_ORIGIN>/mcp` as the resource and `MCP_AUTH_ISSUER` as the authorization server. Write tools wait for owner approval, by name.
