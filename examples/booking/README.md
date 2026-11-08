# Booking example

A small booking backend on [Alchemy Domain](https://alchemy.run/domain) and `@house-rules/stack`. A person books a stay for a guest and pays for it. The payment opens with a 24-hour deadline, the fake provider charges it, and cancelling a booking refunds a paid payment. Each person reads their own bookings.

The same model runs in memory on Node for local play and on Cloudflare Durable Objects in production.

## What it shows

| Idea | Where |
| --- | --- |
| Two aggregates, each deciding its own commands | `packages/domain/src/booking/booking.aggregate.ts`, `packages/domain/src/payment/payment.aggregate.ts` |
| Permissions checked in `decide`, owner and organisation checked against the aggregate's state | `MakeBooking`, `CancelBooking` |
| Policies that react to events as the `billing` system actor | `payment/booking-payment.policy.ts`, `payment/payment-settlement.policy.ts` |
| A deadline as a scheduled command | `PaymentSettlement` schedules `ExpirePayment` at the payment's `expiresAt` |
| An outside system | `payment/payment-provider.external.ts`; the fake adapter is `apps/server/src/fake-payment-provider.ts` |
| A view that is a security boundary | `my-bookings.view.ts`: only you read your bookings |
| Roles turned into permissions once per request | `roles.ts`, `apps/server/src/auth.ts` |
| One Api served as plain HTTP with OpenAPI, Effect RPC, MCP and a CLI | `booking.api.ts`, `apps/server/src/routes.ts`, `apps/server/src/cli.ts` |

```text
MakeBooking ─▶ BookingMade ─▶ BookingPayment ─▶ OpenPayment ─▶ PaymentOpened
                                                                   │
                         PaymentSettlement ◀────────────────────────┘
                         ├─ schedules ExpirePayment (24 hours) ─▶ PaymentExpired, if still pending
                         └─ PaymentProvider.charge ─▶ RecordCharge ─▶ PaymentPaid
CancelBooking ─▶ BookingCancelled ─▶ BookingPayment ─▶ CancelPayment
                         ├─ pending: PaymentCancelled
                         └─ paid: PaymentRefundStarted ─▶ PaymentProvider.refund ─▶ RecordRefund ─▶ PaymentRefunded
```

The fake provider declines charges over 1000, so a large booking stays `pending` until its deadline expires it.

## Layout

```text
packages/domain/           @example/booking-domain: the model, imports only Alchemy, effect and @house-rules/stack
  src/booking/             Booking aggregate, MakeBooking, CancelBooking
  src/payment/             Payment aggregate, its commands, policies and the PaymentProvider declaration
  src/my-bookings.view.ts  MyBookings, keyed by person
  src/booking.model.ts     the Model and its handlers Layer
  src/booking.api.ts       BookingApi: what clients may send and read
  src/tests/               stories
apps/server/               @example/booking-server: hosting
  src/local.ts             Node server, in memory
  src/cli.ts               a CLI over the local server
  src/booking-worker.ts    Cloudflare Worker on Durable Objects
  alchemy.run.ts           the stack that deploys the Worker
  src/tests/               Api test in memory, HTTP smoke test
```

## Run it locally

With Node 24 and pnpm, from the repo root:

```sh
pnpm install
cd examples/booking/apps/server && node src/local.ts
```

The server listens on `http://localhost:3000` (set `PORT` to change it). Everything lives in memory and is gone when it stops. Then, in another shell (curl 7.82 or later, for `--json`):

```sh
curl localhost:3000/MakeBooking -H 'authorization: Bearer ann-token' \
  --json '{"target":"b-1","input":{"guestName":"Grace","amount":100}}'
curl localhost:3000/MyBookings/ann -H 'authorization: Bearer ann-token'
```

The OpenAPI document is at `http://localhost:3000/openapi.json`.

### Dev tokens

| Token | Person | Organisation | Role |
| --- | --- | --- | --- |
| `ann-token` | ann | none | member |
| `carol-token` | carol | acme | member |
| `dave-token` | dave | acme | org-admin |
| `gus-token` | gus | none | guest, no permissions |

Members make, cancel and read their own bookings. An org admin may also cancel any booking made for their organisation.

### More calls

```sh
# book for your organisation, then let its admin cancel it
curl localhost:3000/MakeBooking -H 'authorization: Bearer carol-token' \
  --json '{"target":"acme-1","input":{"guestName":"Ivy","amount":80,"orgId":"acme"}}'
curl localhost:3000/CancelBooking -H 'authorization: Bearer dave-token' \
  --json '{"target":"acme-1","input":{"reason":"duplicate"}}'
curl localhost:3000/MyBookings/carol -H 'authorization: Bearer carol-token'

# refusals answer with their tag and status
curl localhost:3000/MakeBooking -H 'authorization: Bearer gus-token' \
  --json '{"target":"g-1","input":{"guestName":"Jo","amount":10}}'   # 403 Forbidden
curl localhost:3000/MyBookings/ann -H 'authorization: Bearer carol-token'   # 403 NotYourBookings
curl localhost:3000/MyBookings/ann                                       # 401 Unauthenticated
```

### CLI

The CLI talks Effect RPC to `$BOOKING_URL/rpc` (default `http://localhost:3000`) as `$BOOKING_TOKEN` (default `ann-token`). From `examples/booking/apps/server`:

```sh
node src/cli.ts --help
node src/cli.ts make-booking --target b-2 --guest-name Grace --amount 120
node src/cli.ts my-bookings get --key ann
node src/cli.ts cancel-booking --target b-2
BOOKING_TOKEN=gus-token node src/cli.ts make-booking --target b-3 --guest-name Hal --amount 10
```

A rejection prints its JSON on stderr and exits with 1.

### MCP

The server serves every call that returns once as an MCP tool at `http://localhost:3000/mcp` (streamable HTTP, protocol 2025-11-25): `BookingApi_MakeBooking_send`, `BookingApi_CancelBooking_send`, `BookingApi_MyBookings_get`, `_list` and `_snapshot`. The MCP client signs in like any other client, with `authorization: Bearer ann-token`.

## Sign in with Clerk

Set `CLERK_ISSUER` and the local server verifies Clerk session tokens, from the `authorization` header or the `__session` cookie, instead of dev tokens:

```sh
CLERK_ISSUER=https://your-app.clerk.accounts.dev node src/local.ts
```

Optional: `CLERK_JWT_KEY` (the PEM public key, to verify without fetching JWKS) and `CLERK_AUTHORIZED_PARTIES` (comma-separated origins). Every signed-in person is a member. Clerk's organisation roles `org:member` and `org:admin` map to member and org-admin, and the active organisation becomes the person's organisation.

## Deploy to Cloudflare

`apps/server/alchemy.run.ts` declares one Worker hosting the same model on Durable Objects, serving plain HTTP, OpenAPI and `/rpc`. The Worker always uses Clerk, so `CLERK_ISSUER` is required. With Cloudflare credentials for alchemy, from `examples/booking/apps/server`:

```sh
CLERK_ISSUER=https://your-app.clerk.accounts.dev pnpm exec alchemy deploy
pnpm exec alchemy destroy
```

## Tests

```sh
pnpm --filter @example/booking-domain exec vitest run   # stories
pnpm --filter @example/booking-server exec vitest run   # Api in memory and the HTTP server
```

## What the old example had that this one drops

- The React dashboard, the app map (`MAP.md`) and the plan tooling.
- Identity's passwords, sign-up, sign-in, change-password, the first-sign-in hook and grant-admin. Clerk or dev tokens sign people in, and roles come from the auth provider.
- Party: organisations, members, invitations and custom roles. An organisation is the `orgId` the auth provider gives, and org admin is a role.
- Postgres, migrations, Docker, seed data, storage adapters, units of work and the audit log. Alchemy stores the events, and every command is traced.
- The nightly expiry job. Each payment schedules its own expiry when it opens.
- Features, operations, ways and composition. Commands, a view, policies and one Api replace them.
- Org staff reading a colleague's booking. Only the owner reads their bookings, and an org admin may cancel organisation bookings.
