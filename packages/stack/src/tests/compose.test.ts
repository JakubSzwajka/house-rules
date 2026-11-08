import * as Domain from "@alchemy.run/domain";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import {
  Comments,
  Contacts,
  Delivery,
  devTokens,
  Notes,
  Notifications,
  Organisations,
  Projects,
  Relations,
  Roles,
  SessionLive,
  sessionClient,
  WorkItems,
} from "../index.ts";

class Everything extends Domain.Model("Everything", {
  aggregates: [
    ...Comments.aggregates,
    ...Notes.aggregates,
    ...Organisations.aggregates,
    ...Notifications.aggregates,
    ...Contacts.aggregates,
    ...Relations.aggregates,
    ...Projects.aggregates,
    ...WorkItems.aggregates,
  ],
  views: [
    ...Comments.views,
    ...Notes.views,
    ...Organisations.views,
    ...Notifications.views,
    ...Relations.views,
    ...Projects.views,
    ...WorkItems.views,
  ],
  policies: [
    ...Notifications.policies,
    ...Contacts.policies,
    ...Projects.policies,
    ...WorkItems.policies,
  ],
}) {}

class EverythingApi extends Domain.Api("EverythingApi", { model: Everything }) {}

const Hosted = Everything.layer(
  Layer.mergeAll(Notifications.handlers, Contacts.handlers, Projects.handlers, WorkItems.handlers),
).pipe(
  Layer.provide(
    Layer.mergeAll(
      Domain.InMemory,
      Delivery.memoryEmail("app@example.test"),
      Delivery.memoryPush(),
      Contacts.memoryVerificationCodes(),
    ),
  ),
);

const World = Layer.mergeAll(
  SessionLive,
  Projects.projectsConfig(Projects.defaultStatuses),
  WorkItems.workflowConfig(WorkItems.board),
).pipe(
  Layer.provide(
    Layer.mergeAll(
      devTokens({ "ann-token": { subject: "ann", orgId: null, roles: ["member"] } }),
      Roles.layer({
        member: [
          Organisations.OrganisationsPermissions.create,
          Organisations.OrganisationsPermissions.read,
          Comments.CommentsPermissions.write,
          Comments.CommentsPermissions.read,
        ],
      }),
    ),
  ),
  Layer.provideMerge(Hosted),
);

describe("every module in one app", () => {
  it("composes into one well-defined model", () => expect(Domain.verify(Everything)).toEqual([]));

  it.live("hosts every module behind one Api, with one session", () =>
    Effect.gen(function* () {
      const ann = yield* EverythingApi.clientInProcess.pipe(
        Effect.provide(sessionClient("ann-token")),
      );
      yield* ann.CreateOrganisation(Organisations.OrgId.make("acme"), { name: "Acme" });
      const refused = yield* ann
        .Relate(Relations.edgeId("a", "b", "c"), { from: "a", type: "b", to: "c" })
        .pipe(Effect.flip);
      expect(refused._tag).toBe("Forbidden");
    }).pipe(Effect.scoped, Effect.provide(World)),
  );
});
