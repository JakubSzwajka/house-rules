---
title: Modules and data
description: A module is a package with one public entry. It owns its tables, its migrations, and its transactions.
sidebar:
  order: 6
---

A **module** is a piece of behavior with a small interface and a private implementation. In the stack each module is one package. Its public entry, `src/index.ts`, is the seam: the only path its `package.json` `exports` names.

```text
packages/bookings/
├── package.json        exports: { ".": "./src/index.ts" }
├── migrations/*.sql    its tables, when it stores data (bookings does not yet)
└── src/
    ├── index.ts        the one public entry, named exports only
    ├── facade.ts       the service: a Context.Service class
    ├── types.ts        schemas and typed errors
    ├── permissions.ts  the permissions this module names
    ├── internal/       private, nobody outside imports it
    └── tests/          tests import ../index.js only
```

The example is [`packages/bookings`](../../../../../packages/bookings). The [add-an-effect-module](../skills/add-an-effect-module.md) skill walks through making one.

## The service is the interface

A module's service is a `Context.Service` class, such as `Bookings`. Its methods return Effects with no requirements: the service captures its own dependencies. Expected errors are `Schema.TaggedError` classes, such as `BookingNotFound`. A method that acts for a user takes that user as an explicit `Actor` argument and checks access itself.

## A module owns its data

1. [ ] Its migrations live in `packages/<name>/migrations/*.sql`. A table belongs to the package whose migration creates it.
2. [ ] No foreign key to another module's table. Keep the other id as a plain column, and ask that module's service for the record.
3. [ ] Its SQL names only its own tables. To read another module's data, call its service.
4. [ ] One write method is one transaction, and the method opens it. A use-case never opens one, and never spans two modules in one.

The [house-rules-migrations](../rules/node/house-rules-migrations.md) bin checks the first three with a text scan, and catches a use-case that calls `withTransaction` or sends `begin`. The rest of rule 4 is for the reviewer.

## Cartridges and the pull-out test

A **cartridge** is one job plus its own infrastructure, packaged so it pushes in with one `Layer.provide` line. The **pull-out test** asks: delete its package and that line, and does the rest still build and pass? It holds only when the caller owns the port. If a use-case imports the cartridge's package, the capability has to go with it. A reviewer runs this test; no tool does.

## What the checks enforce

- [packages-public-entry-only](../rules/dependency-cruiser/packages-public-entry-only.md) and [packages-imported-by-name](../rules/dependency-cruiser/packages-imported-by-name.md) keep callers on the seam.
- [tests-do-not-import-internals](../rules/dependency-cruiser/tests-do-not-import-internals.md) keeps tests on it too.
- [no-ownerless-files](../rules/dependency-cruiser/no-ownerless-files.md) fails a file or folder named `utils`, `helpers`, or `misc`. Name it after what it owns.
