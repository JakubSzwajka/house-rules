# @house-rules/party

A domain addition: the people an app knows. A `Person` has an `id` that is the `ActorId`, a trimmed `displayName` of 1 to 120 characters, and a `createdAt` in epoch milliseconds. When Party is mounted, the acting user is a Person.

`Party` comes from `@house-rules/domain` and exposes `createPerson`, `get`, `rename` and `erase`. Any actor may read a person; only the person may rename themselves. Writes need an open unit of work. `createPerson` and `erase` take no Actor: the app fills its first-sign-in port with `createPerson`, and calls `erase` when it deletes a user.

Version 0.1.0 is release-ready for its first public release, not yet live on npm. Pin `@house-rules/domain` 0.1.0, `@house-rules/application` 0.2.0 and Effect 4.0.3 exactly. The package ships built JavaScript and declarations in `dist/`, this guide, `AGENTS.md` and its SQL migration. The workspace still imports `src/`.

Mount `Party.layerPostgres` or `Party.layerMemory` in composition. The browser-safe `/contract` entry exports `showPerson` and `renamePerson`, their schemas, errors and permissions. Party has no email, no external ids and no knowledge of identity bindings or JWT verification; it never imports those packages. See `AGENTS.md` for mounting.
