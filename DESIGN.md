# Entry points and projections

## Contract

`defineFeature` remains the command builder, including idempotent commands and existing read-only features. `defineReadModel` creates a read entry point. Branded descriptors carry `kind: "feature" | "read-model"`; neither names, verbs nor lifted flags classify them. `EntryPoint` and `AnyEntryPoint` unite the two types. Existing Feature names remain command-specific. Shared APIs accept the union through the existing `features` registration/exposure field, so old consumers remain source-compatible without reclassification.

Schemas and handlers live together in `features/<name>/index.ts` or `read-models/<name>/index.ts`. Registries are `Features` and `ReadModels`. Both handlers call declared module operations only. Domain computation stays in modules. Read models fix their own readOnly flag to true and reject any reachable operation whose declared readOnly is not true, including process and system edges. Transactional reads remain possible. Entry-to-entry edges fail types, authoring checks and acquisition.

## SQL projection vocabulary

The existing booking MyBookings mount is a service, operations and a binder over a published-view SQL adapter. It is not an exposed entry point. Call this a **projection**. Keep the mount representation, SQL ownership grammar, parameter proof, privacy tests and unavailable port. Give projections an explicit app area `projections/` and map mount kind `projection`. The old mount kind `read-model` remains accepted for staged consumers and means a legacy projection, never a query entry point. Booking moves its existing projection implementation without changing its domain calculations, and exposes the query once with defineReadModel.

## One execution path

```text
HTTP / MCP / system way / in-process call
  admission + decoded schemas
    registered branded entry point identity
      watch + May + closures + approval + one unit
        handler -> declared operation graph -> captured bindings
                       trace + per-operation permission checks
```

The current runtime, runFeature, admission, invocation and transport pipeline execute the union. A runReadModel spelling may alias that same executor, never implement another pipeline. Audit writes remain infrastructure. Missing admission, refusals, identity, credential stripping and disposal keep their existing behavior.

## Deterministic proof

Descriptors, actual maps, plan entry records, JSON schemas, text/HTML/Mermaid renderings and diffs carry the explicit entry kind. Legacy plans/maps without a kind mean feature, not an inferred query. Plan validation builds the actual descriptors and uses runtime graph validation. Source tooling resolves literal builder identity and location. Authoring rules reject wrong-kind placement, services/adapters and unknown or dynamic exposure/edge origins. SQL projection rules remain separate from query composition rules.

Graph proof covers declared readOnly operation reachability, not arbitrary JavaScript purity or dishonest operation metadata. Browser-safe/import fences narrow handler effects; they do not prove semantic purity. SQL grammar and A/B tests cover projection queries, not a production SELECT-only database role. No new system grants, dependencies or runtime versions are needed.

## Verification and migration

Add regression tests before implementing each affected family. Prove direct/transitive/system read-to-write rejection, entry targets, exposure identity and duplicates, plan/map kind and diff behavior, source/lint fail-closed cases, and a real HTTP query plus command sharing runtime/security. Run focused suites, regenerate booking MAP.md and rules docs, then serialize pnpm check and pnpm test.

Consumers can keep defineFeature reads during staged adoption. To migrate, move an exposed read handler into read-models, replace its builder, register/expose it directly, update endpoint imports and plan kinds, and remove only its redundant wrapper. Trainer must wait for verified exports and the final recipe.
