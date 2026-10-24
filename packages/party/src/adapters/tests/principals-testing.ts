import { Approval, CurrentActor, defineFeature, May } from "@house-rules/application";
import { Actor, ActorId, type Permission } from "@house-rules/domain";
import { expect } from "@effect/vitest";
import { Effect, Layer, Option } from "effect";
import { SqlClient } from "effect/sql/SqlClient";
import { PartyOperations } from "../../index.js";

const create = defineFeature("principal_create", {
  ...PartyOperations.createPrincipal,
  permission: null,
  start: { kind: "system", reason: "Trusted provisioning", startedBy: "tests" },
  edges: [PartyOperations.createPrincipal],
  handler: (input, { call }) => call(PartyOperations.createPrincipal, input),
});
const personCreate = defineFeature("principal_person_create", {
  ...PartyOperations.createPrincipal,
  permission: null,
  edges: [PartyOperations.createPrincipal],
  handler: (input, { call }) => call(PartyOperations.createPrincipal, input),
});
const disable = defineFeature("principal_disable", {
  ...PartyOperations.disable,
  permission: null,
  start: { kind: "system", reason: "Trusted disable", startedBy: "tests" },
  edges: [PartyOperations.disable],
  handler: (input, { call }) => call(PartyOperations.disable, input),
});
const personDisable = defineFeature("principal_person_disable", {
  ...PartyOperations.disable,
  permission: null,
  edges: [PartyOperations.disable],
  handler: (input, { call }) => call(PartyOperations.disable, input),
});
const lock = defineFeature("principal_lock", {
  ...PartyOperations.lockActive,
  permission: null,
  start: { kind: "system", reason: "Token provisioning", startedBy: "tests" },
  edges: [PartyOperations.lockActive],
  handler: (input, { call }) => call(PartyOperations.lockActive, input),
});
const personLock = defineFeature("principal_person_lock", {
  ...PartyOperations.lockActive,
  permission: null,
  edges: [PartyOperations.lockActive],
  handler: (input, { call }) => call(PartyOperations.lockActive, input),
});
const read = defineFeature("principal_read", {
  ...PartyOperations.principalsByIds,
  permission: null,
  start: { kind: "system", reason: "Notification names", startedBy: "tests" },
  edges: [PartyOperations.principalsByIds],
  handler: (input, { call }) => call(PartyOperations.principalsByIds, input),
});
const personRead = defineFeature("principal_person_read", {
  ...PartyOperations.principalsByIds,
  permission: null,
  edges: [PartyOperations.principalsByIds],
  handler: (input, { call }) => call(PartyOperations.principalsByIds, input),
});
const doubleCreate = defineFeature("principal_double_create", {
  ...PartyOperations.createPrincipal,
  permission: null,
  start: { kind: "system", reason: "Rollback proof", startedBy: "tests" },
  edges: [PartyOperations.createPrincipal],
  handler: (input, { call }) =>
    Effect.gen(function* () {
      yield* call(PartyOperations.createPrincipal, input);
      return yield* call(PartyOperations.createPrincipal, input);
    }),
});
const features = [
  create,
  personCreate,
  disable,
  personDisable,
  lock,
  personLock,
  read,
  personRead,
  doubleCreate,
];
const permissions: readonly Permission[] = ["party:create", "party:update", "party:read"];
const actor = Actor.make({ id: ActorId.make("principal-owner-caller") });
const request = Layer.mergeAll(
  Layer.succeed(CurrentActor, actor),
  Layer.succeedContext(
    May.context(May.fixed(permissions), { features, system: permissions, via: "test" }),
  ),
  Approval.allowAll,
);
const input = (handle: string, kind: "person" | "agent" = "agent") => ({
  id: ActorId.make(`principal-${handle}`),
  handle,
  kind,
  displayName: `Name ${handle}`,
  createdBy: actor.id,
});
const backendPid = Effect.gen(function* () {
  const client = yield* Effect.serviceOption(SqlClient);
  if (Option.isNone(client)) return undefined;
  const rows = yield* client.value<{ pid: number }>`select pg_backend_pid() as pid`;
  expect(rows[0]?.pid).toEqual(expect.any(Number));
  return rows[0]?.pid;
});
const waitForBlocked = Effect.fn("principalsTesting.waitForBlocked")(function* (
  holderPid: number | undefined,
  pending: () => boolean,
) {
  if (holderPid === undefined) {
    yield* Effect.yieldNow;
  } else {
    const client = yield* Effect.serviceOption(SqlClient);
    if (Option.isNone(client)) return yield* Effect.die("Postgres client missing");
    const sql = client.value;
    // Identify the held transaction, regardless of which statement blocks on it.
    yield* Effect.gen(function* () {
      while (true) {
        expect(pending()).toBe(true);
        const rows = yield* sql`select pid from pg_stat_activity
          where datname = current_database() and wait_event_type = 'Lock'
          and ${holderPid} = any(pg_blocking_pids(pid))`;
        if (rows.length > 0) break;
        yield* Effect.yieldNow;
      }
    }).pipe(Effect.timeout("3 seconds"));
  }
  expect(pending()).toBe(true);
});
export const principalsTesting = {
  backendPid,
  waitForBlocked,
  create,
  personCreate,
  disable,
  personDisable,
  lock,
  personLock,
  read,
  personRead,
  doubleCreate,
  features,
  request,
  input,
  actor,
};
