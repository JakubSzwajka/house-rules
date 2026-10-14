---
name: mount-a-module
description: Mount an existing module package in an app through its composition root, host ports and shipped contracts.
---

# Mount a module

Use this when the module already exists. To build a new module, follow
[add-an-effect-module](../add-an-effect-module/SKILL.md).

## Read the package

1. [ ] Get owner approval before adding its dependency. Keep the repo's package
   manager and runtime. Add the module to the app with an exact version, or an
   exact `workspace:<version>` pin, then update the lockfile.
2. [ ] Read `node_modules/<pkg>/AGENTS.md` and its README. For a workspace module,
   read those files in its package folder. Follow its mount guide rather than
   copying it into the app.
3. [ ] Identify what its Layer provides, its unmet host ports and its acquisition
   errors. Check its presets and deletion hooks. A preset does not choose
   app-owned values unless the package says so.

## Wire composition

4. [ ] Add the module's layer line only in `src/composition/`. Choose its storage
   adapter there. Share the same database and unit-of-work adapter with the
   app's other stores.
5. [ ] Fill each host port with a layer that captures your own module's service
   and calls it for facts. Map failures to the port's declared errors. Do not
   query another module's tables or capture a request's `CurrentActor`.
6. [ ] Add the module's entry to root `migrations.json` as its guide says. Use a
   workspace entry for a local package and a package entry for an installed one.
7. [ ] Wire its deletion hooks into the app's target and user deletion use-cases,
   inside the same open unit. Add views for acquisition and method errors.

## Add use-cases and prove the mount

8. [ ] Wrap shipped contracts with thin `implement(contract, handler)` files.
   Import `implement` and `CurrentActor` from `@house-rules/application`.
   Yield the module and `CurrentActor`, then pass the Actor to the service.
   Leave object access checks in the module. Keep the per-request Grant and
   `CurrentActor` at delivery.
9. [ ] Test with allowed and denied actors through the composition. Check that
   a missing host port fails the app-layer type check. Do not expose a route or
   tool until the app can supply real identity and the owner approves it.
10. [ ] Run `pnpm check` and `pnpm test`. Fix failures without weakening rules.
    Confirm the migration entry is checked and no package pin became a range.
