---
name: add-a-capability
description: Add one action to an app as a capability. Define its contract with a permission, implement the handler on a module's service, call it from delivery, and test the gates and the typed errors.
---

# Add a capability

A capability is one named action: a contract plus one handler. Every use-case is one. Write the action once, and let each adapter reach it. The module does the work and checks the object. The capability only names the action and its gates.

This skill assumes the module exists. If it does not, follow `skills/add-an-effect-module/SKILL.md` first. Read `packages/capability/README.md` for the full API.

## 1. Name the permission in the module

The module that owns the data names its permissions, next to its data, as `packages/bookings/src/permissions.ts` does:

```ts
export const BookingPermissions = {
  read: "bookings:read",
} as const;
```

A permission is a `resource:action` string. Several capabilities can share one. Export it from the package's `src/index.ts`.

Use `"public"` only for an action any caller may run, and only on purpose.

## 2. Define the contract

Create `apps/<app>/src/use-cases/<action>.ts`. One file, one capability.

```ts
export const showBookingContract = defineContract("show_booking", {
  description: "Show one booking by its id.",
  input: Schema.Struct({ id: Schema.String }),
  output: Booking,
  failure: BookingNotFound,
  permission: BookingPermissions.read,
  annotations: { readOnly: true },
});
```

1. [ ] Give it a stable name, such as `show_booking`. `toTool` uses it as the MCP tool name.
2. [ ] Use the module's schemas for `output` and its `Schema.TaggedError` for `failure`.
3. [ ] Set `readOnly` for a read, `destructive` for a delete or overwrite. Leave both out for a plain write.
4. [ ] Set `needsApproval: true` when a human must confirm each call, such as delete or share.
5. [ ] An action with no input uses `NoInput`, never `Schema.Struct({})`.

## 3. Implement the handler

```ts
export const showBooking = implement(showBookingContract, ({ id }) =>
  Effect.gen(function* showBookingHandler() {
    const bookings = yield* Bookings;
    return yield* bookings.get(id);
  }),
);
```

The handler yields services and calls their methods. Let typed errors flow. Do not catch them, do not open a transaction, and do not import another use-case. When the action acts for a user, yield the `Viewer` and pass its `Actor` to the service.

The file exports the contract, the capability, and types. Nothing else. `use-case-is-capability` fails anything more.

## 4. Call it from delivery

An adapter in `src/delivery/` calls `showBooking.handler(input)`, provides the gate slots, and maps every typed error once:

1. [ ] Provide `Grant` for the request, such as `Grant.layerFromPermissions([...])` from the caller's role.
2. [ ] Provide `Approval` when the contract needs it: `Approval.allowAll` on the web, where the click is the yes; `elicitationApproval` on MCP.
3. [ ] Map the contract's failure, plus `Forbidden` and `ApprovalDenied` when the gates add them, with `Effect.catchTags`. The handler's error channel ends as `never`.

`apps/api/src/delivery/http/get-booking-route.ts` is the example. For an MCP tool, follow `skills/add-an-mcp-tool/SKILL.md`, which builds the tool with `toTool(capability.contract, ...)`. Never call `Tool.make` by hand: `no-hand-rolled-surface` fails it.

## 5. Test it

Put the test in `apps/<app>/src/use-cases/tests/<action>.test.ts`. Use `@effect/vitest`, with `it.effect` or `it.layer`. Never `Effect.run*`.

1. [ ] The handler returns the output for a good input.
2. [ ] It fails with the contract's typed error. Inspect it with `Effect.flip`.
3. [ ] With `Grant.denyAll`, it fails with `Forbidden` before the service is called.
4. [ ] With `needsApproval`, `Approval.denyAll` fails with `ApprovalDenied`.

## 6. Prove it

```sh
pnpm check
pnpm test
```

Fix failures. Do not loosen a rule, a hook, or a pin.
