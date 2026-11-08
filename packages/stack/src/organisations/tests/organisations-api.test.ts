import { platformForTests } from "@house-rules/domain-postgres";
import * as Domain from "@alchemy.run/domain";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { Roles } from "../../access/roles.ts";
import { PersonId } from "../../actor/actor.ts";
import { devTokens } from "../../auth/dev-tokens.ts";
import { SessionLive } from "../../auth/session-live.ts";
import { sessionClient } from "../../auth/session.middleware.ts";
import {
  aggregates,
  OrganisationsPermissions as P,
  OrgId,
  views,
  withMemberships,
} from "../index.ts";

class Organisations extends Domain.Model("Organisations", { aggregates, views }) {}
class OrganisationsApi extends Domain.Api("OrganisationsApi", {
  model: Organisations,
  commands: ["CreateOrganisation", "AddMember", "RemoveMember"],
  views: ["PersonOrganisations"],
  aggregates: ["Organisation"],
}) {}

const acme = OrgId.make("acme");
const World = SessionLive.pipe(
  Layer.provide(
    Layer.mergeAll(
      withMemberships(
        devTokens({
          "ann-token": { subject: "ann", orgId: "acme", roles: ["user"] },
          "bob-token": { subject: "bob", orgId: "acme", roles: [] },
          "carol-token": { subject: "carol", orgId: "acme", roles: ["auditor"] },
        }),
      ),
      Roles.layer({
        user: [P.create],
        auditor: [P.read],
        member: [P.read],
        admin: [P.read, P.manage],
      }),
    ),
  ),
  Layer.provideMerge(Organisations.layer(Layer.empty).pipe(Layer.provide(platformForTests))),
);
const as = (token: string) =>
  OrganisationsApi.clientInProcess.pipe(Effect.provide(sessionClient(token)));

describe("Organisations over the Api", () => {
  it.live("adds a member's role in the active organisation to their session", () =>
    Effect.gen(function* () {
      const ann = yield* as("ann-token");
      const bob = yield* as("bob-token");
      const carol = yield* as("carol-token");

      const outsider = yield* bob.Organisation.get(acme).pipe(Effect.flip);
      expect(outsider._tag).toBe("Forbidden");

      yield* ann.CreateOrganisation(acme, { name: "Acme" });
      const added = yield* ann.AddMember(acme, { person: PersonId.make("bob"), role: "member" });

      const state = yield* bob.Organisation.get(acme);
      expect(state).toEqual({
        _tag: "Founded",
        name: "Acme",
        members: { ann: "admin", bob: "member" },
      });
      const mine = yield* bob.PersonOrganisations.get(PersonId.make("bob"), {
        atLeast: { stream: added.stream, version: added.version },
      });
      expect(mine).toEqual({ organisations: { acme: "member" } });
      const others = yield* bob.PersonOrganisations.get(PersonId.make("ann")).pipe(Effect.flip);
      expect(others._tag).toBe("NotYourself");

      const refused = yield* bob
        .RemoveMember(acme, { person: PersonId.make("ann") })
        .pipe(Effect.flip);
      expect(refused._tag).toBe("Forbidden");
      const stranger = yield* carol.Organisation.get(acme).pipe(Effect.flip);
      expect(stranger._tag).toBe("NotMember");

      yield* ann.RemoveMember(acme, { person: PersonId.make("bob") });
      const removed = yield* bob.Organisation.get(acme).pipe(Effect.flip);
      expect(removed._tag).toBe("Forbidden");
    }).pipe(Effect.scoped, Effect.provide(World)),
  );
});
