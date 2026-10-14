# @house-rules/identity

Turns a verified `Principal` into an `ActorId`, and fills an app's `Caller` with `CurrentActor` and `Grant`. An `Authenticator`, such as `@house-rules/auth-jwt`, checks the token. This package decides who the caller is. It never links by email.

Version 0.1.0 is release-ready for its first public release, not yet live on npm. Pin `@house-rules/domain` 0.1.0, `@house-rules/application` 0.2.0 and Effect 4.0.3 exactly. The package ships built JavaScript and declarations in `dist/`, this guide, `AGENTS.md` and its SQL migration.

## Pieces

- `Identity`: a module that owns `identity_binding`, `(issuer, subject) -> actor_id`. Methods: `resolve`, `bind`, `unbind`, `bindingsOf`, `unbindAll`. Writes need an open unit of work.
- `ActorResolver`: a slot. `Identity.layerPostgres` and `Identity.layerMemory` fill it from the bindings. `Identity.subject({ issuer })` fills it with no table: the subject is the `ActorId`, for one issuer; any other issuer is refused 401 `token_invalid` before `FirstSignIn`.
- `FirstSignIn`: a port for an unknown login. `Identity.refuse` answers 403 `not_invited`. An app that creates accounts writes its own filler. It opens `UnitOfWork.atomic` itself, creates the actor id, calls `Identity.bind`, and returns the id.
- `Identity.caller({ token, audience?, grant, challenge? })`: reads the token, verifies it, resolves the actor, and builds `CurrentActor` and `Grant`.

```ts
const firstSignIn = Layer.effect(FirstSignIn, Effect.gen(function* () {
  const identity = yield* Identity;
  const unitOfWork = yield* UnitOfWork;
  return (principal) =>
    unitOfWork.atomic(Effect.gen(function* () {
      const id = yield* createActorId;
      yield* identity.bind(principal, id);
      return id;
    })).pipe(Effect.mapError(() => new Refused({ status: 503, code: "sign_in_failed", message: "Try again." })));
}));
```

See `AGENTS.md` for mounting steps, refusal codes and the fixed rules.
