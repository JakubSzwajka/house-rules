import { ActorId, type NoOpenUnit, UnitOfWork } from "@house-rules/domain";
import { DateTime, Effect, Random, Schema } from "effect";
import type { PartyOptions } from "../role/role.js";
import type { PersonStore } from "../storage.js";
import {
  DisplayName,
  PersonAlreadyExists,
  PersonInputInvalid,
  PersonNotFound,
  type PersonStoreUnavailable,
} from "./person.js";
import {
  CreatePrincipal,
  type Principal,
  PrincipalDisabledRefused,
  PrincipalHandle,
  PrincipalKindRefused,
  type CreatedPrincipal,
  type DisabledPrincipal,
  type PrincipalKind,
} from "./principal.js";

export const makePrincipals = (store: PersonStore["Service"], options: PartyOptions) => {
  const handle = options.handles?.pattern
    ? PrincipalHandle.check(Schema.isPattern(options.handles.pattern))
    : PrincipalHandle;
  const decodeInput = Schema.decodeUnknownEffect(CreatePrincipal);
  const decodeHandle = Schema.decodeUnknownEffect(handle);
  const decodeName = Schema.decodeUnknownEffect(DisplayName);
  const invalid = () => new PersonInputInvalid({ message: "Invalid principal input." });
  return {
    createPrincipal: Effect.fn("Party.createPrincipal")(function* (
      input: CreatePrincipal,
    ): Effect.fn.Return<
      CreatedPrincipal,
      PersonInputInvalid | PersonAlreadyExists | PersonStoreUnavailable | NoOpenUnit
    > {
      yield* UnitOfWork.required;
      const decoded = yield* decodeInput(input).pipe(Effect.mapError(invalid));
      const handle = yield* decodeHandle(decoded.handle).pipe(Effect.mapError(invalid));
      if (options.handles?.reserved?.includes(handle)) return yield* invalid();
      const displayName = yield* decodeName(decoded.displayName).pipe(Effect.mapError(invalid));
      const words = yield* Effect.all(
        Array.from({ length: 4 }, () => Random.nextIntBetween(0, 0xffff_ffff)),
      );
      const principal: Principal = {
        ...decoded,
        id: decoded.id ?? ActorId.make(words.map((w) => w.toString(16).padStart(8, "0")).join("")),
        handle,
        displayName,
        createdAt: DateTime.toEpochMillis(yield* DateTime.now),
        disabledAt: null,
      };
      if (!(yield* store.insertPrincipal(principal))) return yield* new PersonAlreadyExists();
      return { principal, fact: { kind: "principal.created", after: principal } };
    }),
    standingOf: Effect.fn("Party.standingOf")(function* (id: ActorId) {
      const principal = yield* store.principal(id);
      return principal === undefined
        ? ("missing" as const)
        : principal.disabledAt === null
          ? ("active" as const)
          : ("disabled" as const);
    }),
    lockActive: Effect.fn("Party.lockActive")(function* (input: {
      readonly handle: string;
      readonly kind: PrincipalKind;
    }) {
      yield* UnitOfWork.required;
      const principal = yield* store.lockPrincipal(input.handle);
      if (!principal) return yield* new PersonNotFound();
      if (principal.kind !== input.kind) return yield* new PrincipalKindRefused();
      if (principal.disabledAt !== null) return yield* new PrincipalDisabledRefused();
      return principal;
    }),
    disable: Effect.fn("Party.disable")(function* (
      id: ActorId,
    ): Effect.fn.Return<DisabledPrincipal, PersonNotFound | PersonStoreUnavailable | NoOpenUnit> {
      yield* UnitOfWork.required;
      const before = yield* store.principalForUpdate(id);
      if (!before) return yield* new PersonNotFound();
      if (before.disabledAt !== null) return { principal: before, fact: null };
      const after = yield* store.disable(id, DateTime.toEpochMillis(yield* DateTime.now));
      if (!after) return yield* new PersonNotFound();
      return { principal: after, fact: { kind: "principal.disabled", before, after } };
    }),
    findPrincipal: Effect.fn("Party.findPrincipal")(function* (input: { readonly handle: string }) {
      const principal = yield* store.principalByHandle(input.handle);
      if (!principal) return yield* new PersonNotFound();
      return principal;
    }),
    principalsByIds: (ids: readonly ActorId[]) => store.principalsByIds(ids),
  };
};
