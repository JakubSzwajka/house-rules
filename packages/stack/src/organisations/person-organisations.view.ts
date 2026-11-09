import * as Domain from "@alchemy.run/domain";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { Forbidden } from "../access/forbidden.rejection.ts";
import { requirePermission } from "../access/require-permission.ts";
import { PersonId } from "../actor/actor.ts";
import { Session } from "../auth/session.middleware.ts";
import { Organisation } from "./organisation.aggregate.ts";
import { ADMIN_ROLE } from "./organisation.id.ts";
import { OrganisationsPermissions } from "./permissions.ts";

export class NotYourself extends Domain.Rejection("NotYourself", {}, { httpApiStatus: 403 }) {}

const Memberships = Schema.Struct({ organisations: Schema.Record(Schema.String, Schema.String) });
type Memberships = typeof Memberships.Type;

const joined = (v: Memberships, org: string, role: string): Memberships => ({
  organisations: { ...v.organisations, [org]: role },
});

export class PersonOrganisations extends Domain.View("PersonOrganisations", {
  from: [Organisation],
  key: PersonId,
  middleware: [Session],
  rejects: [Forbidden, NotYourself],
  state: Memberships,
  initial: { organisations: {} },
  keyOf: {
    OrganisationCreated: ({ event }) => event.admin,
    OrganisationMemberAdded: ({ event }) => event.person,
    OrganisationMemberRoleChanged: ({ event }) => event.person,
    OrganisationMemberRemoved: ({ event }) => event.person,
  },
  evolve: {
    OrganisationCreated: (v, _e, { source }) => joined(v, source.id, ADMIN_ROLE),
    OrganisationMemberAdded: (v, e, { source }) => joined(v, source.id, e.role),
    OrganisationMemberRoleChanged: (v, e, { source }) => joined(v, source.id, e.role),
    OrganisationMemberRemoved: (v, _e, { source }) => ({
      organisations: Object.fromEntries(
        Object.entries(v.organisations).filter(([org]) => org !== source.id),
      ),
    }),
  },
  validate: Effect.fn(function* (request) {
    const actor = yield* requirePermission(OrganisationsPermissions.read);
    if (actor._tag !== "System" && actor.id !== request.key) return yield* new NotYourself();
  }),
}) {}
