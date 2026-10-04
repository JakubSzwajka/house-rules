---
title: Capabilities and authorization
description: One action is one contract and one handler. The Grant and Approval gates run before it, and the module checks the object.
sidebar:
  order: 5
---

A **capability** is one named action an app offers, such as "show a booking". It pairs a **contract** with one handler. Every use-case is a capability, and every surface an outside caller reaches, such as an MCP tool, is built from a contract. You write each action once.

The library is [`@house-rules/capability`](../../../../../packages/capability/README.md). The [add-a-capability](../skills/add-a-capability.md) skill walks through adding one.

## The shape

```text
adapter      HTTP route   MCP tool   CLI command    decides who calls, maps errors
                  \           |          /
gates               Grant, then Approval             may this caller, does a human mean it
                              |
capability          contract + handler               one action, typed in and out
                              |
service             Bookings (a module's interface)  rules, checks of one object, data
```

The contract holds the name, a description, Effect Schemas for input, output, and failure, the `readOnly` and `destructive` flags, a `permission`, and `needsApproval`. The handler is an Effect: it takes the decoded input and yields services.

The example in the stack is [`show-booking.ts`](../../../../../apps/api/src/use-cases/show-booking.ts):

```ts
export const showBookingContract = defineContract("show_booking", {
  description: "Show one booking by its id.",
  input: Schema.Struct({ id: Schema.String }),
  output: Booking,
  failure: BookingNotFound,
  permission: BookingPermissions.read,
  annotations: { readOnly: true },
});

export const showBooking = implement(showBookingContract, ({ id }) =>
  Effect.gen(function* showBookingHandler() {
    const bookings = yield* Bookings;
    return yield* bookings.get(id);
  }),
);
```

## Four questions per call

Each call answers four questions, in this order:

| Question | Who answers | Fails with |
| --- | --- | --- |
| Who calls? | The adapter, by building the `Viewer` | its own 401 |
| May this caller do this at all? | `Grant`, from the contract's permission | `Forbidden` |
| Does a human mean it, now? | `Approval`, when `needsApproval: true` | `ApprovalDenied` |
| May the caller act on this one object? | The module, with its own data | "not found" |

A **permission** is a `resource:action` string, such as `bookings:read`. The module that owns the resource names it, as [`permissions.ts`](../../../../../packages/bookings/src/permissions.ts) does. A contract that any caller may run says `permission: "public"` on purpose. The type rejects a contract with no permission.

The Grant runs before any data is read, so it cannot leak whether a record exists. Approval is consent, not permission: on MCP it asks the human through the client, and an agent can never answer its own approval.

## Relations stay in the module

A relation is how the caller stands to one object, such as owner or shared. A policy maps each relation to the permissions it carries. The module checks the relation against its own data, and "not yours" looks the same as "not found". `definePolicy` gives the shape and a who × action table for tests.

## What the checks enforce

- [use-case-is-capability](../rules/eslint/use-case-is-capability.md): a use-case file exports exactly one `implement(...)` capability, at most one contract, and nothing else.
- [no-hand-rolled-surface](../rules/eslint/no-hand-rolled-surface.md): no `Tool.make`, `Rpc.make`, or `HttpApiEndpoint` outside `packages/capability`.
- The types: a handler that fails with an error its contract does not declare does not compile.

Delivery maps typed errors to responses once, gate errors included. [`get-booking-route.ts`](../../../../../apps/api/src/delivery/http/get-booking-route.ts) maps `BookingNotFound` to 404 and `Forbidden` to 403, so its error channel ends as `never`.
