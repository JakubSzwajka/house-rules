import { type Caller, UnitOfWork } from "@house-rules/domain";
import { Clock, Effect } from "effect";
import { Hex } from "effect/encoding";
import { PartyDenied, PartyNotFound, PartyUnavailable } from "../organisation/organisation.js";
import type { PartyStore } from "../storage.js";
import type { StoredInvitation } from "./invitation.js";

const publicInvitation = ({ codeHash: _hash, ...value }: StoredInvitation) => value;
const hashCode = (code: string) =>
  Effect.tryPromise({
    try: () => globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(code)),
    catch: (cause) => new PartyUnavailable({ cause }),
  }).pipe(Effect.map((bytes) => Hex.encode(new Uint8Array(bytes))));
const randomCode = Effect.sync(() =>
  Hex.encode(globalThis.crypto.getRandomValues(new Uint8Array(32))),
);

export const makeInvitations = (
  store: PartyStore["Service"],
  admin: (
    caller: Caller,
    organisationId: string | null,
  ) => Effect.Effect<void, PartyDenied | PartyUnavailable>,
  checkRole: (
    caller: Caller,
    key: string,
    org: string,
  ) => Effect.Effect<void, PartyDenied | PartyNotFound | PartyUnavailable>,
) => ({
  createInvitation: Effect.fn("Party.createInvitation")(function* (
    caller: Caller,
    input: { readonly organisationId: string; readonly roleKey: string | null },
  ) {
    yield* UnitOfWork.required;
    yield* admin(caller, input.organisationId);
    if (caller.kind !== "person") return yield* new PartyDenied();
    if (!(yield* store.organisation(input.organisationId))) return yield* new PartyNotFound();
    if (input.roleKey !== null) yield* checkRole(caller, input.roleKey, input.organisationId);
    const code = yield* randomCode;
    const value: StoredInvitation = {
      id: yield* randomCode,
      organisationId: input.organisationId,
      roleKey: input.roleKey,
      createdBy: caller.actor.id,
      codeHash: yield* hashCode(code),
      expiresAt: (yield* Clock.currentTimeMillis) + 7 * 24 * 60 * 60 * 1000,
      state: "pending",
    };
    yield* store.insertInvitation(value);
    return { invitation: publicInvitation(value), code };
  }),
  acceptInvitation: Effect.fn("Party.acceptInvitation")(function* (caller: Caller, code: string) {
    yield* UnitOfWork.required;
    if (caller.kind !== "person") return yield* new PartyDenied();
    const value = yield* store.consumeInvitation(
      yield* hashCode(code),
      yield* Clock.currentTimeMillis,
    );
    // One conditional UPDATE claims the code. A rolled-back feature restores it.
    if (!value) return yield* new PartyNotFound();
    if (value.roleKey !== null)
      yield* checkRole(
        { kind: "person", actor: { id: value.createdBy }, via: caller.via },
        value.roleKey,
        value.organisationId,
      ).pipe(
        Effect.catchTags({
          PartyDenied: () => new PartyNotFound(),
          PartyNotFound: () => new PartyNotFound(),
        }),
      );
    yield* store.relate({
      from: { kind: "person", id: caller.actor.id },
      to: { kind: "organisation", id: value.organisationId },
      kind: "staff",
    });
    return {
      organisationId: value.organisationId,
      roleKey: value.roleKey,
      personId: caller.actor.id,
    };
  }),
  revokeInvitation: Effect.fn("Party.revokeInvitation")(function* (caller: Caller, id: string) {
    yield* UnitOfWork.required;
    const value = yield* store.invitation(id);
    if (!value) return yield* new PartyNotFound();
    yield* admin(caller, value.organisationId);
    yield* store.revokeInvitation(id);
  }),
  listInvitations: Effect.fn("Party.listInvitations")(function* (
    caller: Caller,
    organisationId: string,
  ) {
    yield* admin(caller, organisationId);
    return (yield* store.invitations(organisationId)).map(publicInvitation);
  }),
});
