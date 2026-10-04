# Use-case is a capability rule

Rule ID: `house-rules/use-case-is-capability`

Every use-case is a capability. The rule runs on each use-case file and checks that it exports exactly one capability, built with `implement` from `@house-rules/capability`. Enable it with `plugin.configs.capability`.

```ts
// apps/api/src/use-cases/show-booking.ts: passes
import { defineContract, implement } from "@house-rules/capability";

export const showBookingContract = defineContract("show_booking", { ... });
export const showBooking = implement(showBookingContract, ({ id }) => ...);
export type ShowBooking = typeof showBooking;
```

```ts
// apps/api/src/use-cases/show-booking.ts: reported twice
export const showBooking = Effect.fn("showBooking")(function* (id: string) { ... });
```

## What the rule checks

In a use-case file:

1. Exactly one exported `const` is initialised by a call to `implement` imported from `@house-rules/capability`. A named import, an alias, and a namespace import (`Capability.implement(...)`) all count. A local function named `implement`, or one imported from anywhere else, does not.
2. At most one exported `const` is initialised by `defineContract` from the same package. The contract may also stay unexported.
3. No other value is exported. Functions, classes, enums, `let`, a default export, `export *`, and re-exports from another file are reported. Types are allowed: `export type`, `export interface`, and `export type { ... }`.

`export { showBooking }` counts when `showBooking` is a top-level `const` initialised by `implement`. A cast or `satisfies` around the call still counts.

## Messages

- `A use-case file exports exactly one capability, export const <name> = implement(contract, handler), with implement imported from @house-rules/capability. This file exports none.`
- `A use-case file exports exactly one capability. Move <name> to its own use-case file.`
- `A use-case file exports at most one contract, the one its capability implements. Move <name> to its own use-case file.`
- `A use-case file exports only its capability, its contract, and types. Keep <name> unexported, or move it into a package.`

## Options

```ts
type Options = [
  {
    include?: string[]; // default: ["apps/*/src/use-cases/**/*.{ts,tsx,mts,cts}"]
    exclude?: string[]; // default: ["**/tests/**", "**/*.{test,spec}.{ts,tsx,mts,cts}"]
  },
];
```

Globs are relative to ESLint's working directory. Nested folders count: `apps/web/src/use-cases/trips/create-trip.ts` is a use-case file. Test files are skipped.

## Limits

The rule reads one file. It does not check that the exported contract is the one the capability implements, or that the handler is an Effect: TypeScript checks the handler through `implement`'s types.
