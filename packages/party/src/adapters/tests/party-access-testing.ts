import { Actor, ActorId, type PersonCaller } from "@house-rules/domain";
import { Effect } from "effect";
import { Party } from "../../index.js";

export const systemTesting = {
  kind: "system",
  reason: "First sign-in",
  startedBy: "test",
} as const;
export const partyOptionsTesting = {
  builtInRoles: {
    admin: { name: "Admin", permissions: ["party:admin", "party:read"] },
    reader: { name: "Reader", permissions: ["party:read"] },
  },
};
export const fixtureTesting = () => {
  let serial = 0;
  return Effect.fn("Party.fixture")(function* () {
    const party = yield* Party;
    const id = `access-${++serial}`;
    const caller = (suffix: string, via: string): PersonCaller => ({
      kind: "person",
      actor: Actor.make({ id: ActorId.make(`${id}-${suffix}`) }),
      via,
    });
    const admin = caller("admin", "test");
    const scoped = caller("scoped", "mcp");
    const person = caller("person", "http");
    for (const c of [admin, scoped, person])
      yield* party.createPerson({ id: c.actor.id, displayName: id });
    yield* party.assignRole(systemTesting, {
      personId: admin.actor.id,
      roleKey: "admin",
      organisationId: null,
    });
    const x = { id: `${id}-x`, name: "X" };
    const y = { id: `${id}-y`, name: "Y" };
    yield* party.createOrganisation(admin, x);
    yield* party.createOrganisation(admin, y);
    yield* party.assignRole(admin, {
      personId: scoped.actor.id,
      roleKey: "admin",
      organisationId: x.id,
    });
    return { party, id, admin, scoped, person, x, y };
  });
};
