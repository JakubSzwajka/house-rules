import * as Domain from "@alchemy.run/domain";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { Forbidden } from "../access/forbidden.rejection.ts";
import { requirePermission } from "../access/require-permission.ts";
import { attributionOf, type PersonId } from "../actor/actor.ts";
import { Session } from "../auth/session.middleware.ts";
import { AddMember, AlreadyMember, OrganisationMemberAdded } from "./add-member.command.ts";
import { ChangeMemberRole, OrganisationMemberRoleChanged } from "./change-member-role.command.ts";
import {
  AdminRequired,
  CreateOrganisation,
  OrganisationCreated,
  OrganisationExists,
} from "./create-organisation.command.ts";
import { LastAdmin } from "./last-admin.rejection.ts";
import { NotAdmin } from "./not-admin.rejection.ts";
import { NotMember } from "./not-member.rejection.ts";
import { ADMIN_ROLE, OrgId } from "./organisation.id.ts";
import { OrganisationNotFound } from "./organisation-not-found.rejection.ts";
import { OrganisationsPermissions } from "./permissions.ts";
import { OrganisationMemberRemoved, RemoveMember } from "./remove-member.command.ts";

const Members = Schema.Record(Schema.String, Schema.String);
type Members = typeof Members.Type;

export const OrganisationState = Schema.Union([
  Schema.TaggedStruct("Unfounded", {}),
  Schema.TaggedStruct("Founded", { name: Schema.String, members: Members }),
]);
export type OrganisationState = typeof OrganisationState.Type;

const asAdmin = Effect.fn(function* (s: OrganisationState) {
  const actor = yield* requirePermission(OrganisationsPermissions.manage);
  const founded = s._tag === "Founded" ? s : undefined;
  if (actor._tag !== "System" && founded?.members[actor.id] !== ADMIN_ROLE)
    return yield* new NotAdmin();
  if (founded === undefined) return yield* new OrganisationNotFound();
  return { members: founded.members, attribution: attributionOf(actor) };
});

const roleOf = (members: Members, person: PersonId) =>
  Object.hasOwn(members, person) ? members[person] : undefined;

const isLastAdmin = (members: Members, person: PersonId) =>
  members[person] === ADMIN_ROLE &&
  Object.values(members).filter((role) => role === ADMIN_ROLE).length === 1;

const withoutMember = (members: Members, person: string): Members =>
  Object.fromEntries(Object.entries(members).filter(([id]) => id !== person));

const withMember = (s: OrganisationState, person: string, role: string): OrganisationState =>
  s._tag === "Founded" ? { ...s, members: { ...s.members, [person]: role } } : s;

export class Organisation extends Domain.Aggregate("Organisation", {
  id: OrgId,
  state: OrganisationState,
  initial: { _tag: "Unfounded" },
  commands: [CreateOrganisation, AddMember, ChangeMemberRole, RemoveMember],
  decide: {
    CreateOrganisation: Effect.fn(function* (s, cmd) {
      const actor = yield* requirePermission(OrganisationsPermissions.create);
      if (s._tag === "Founded") return yield* new OrganisationExists();
      const admin = cmd.admin ?? (actor._tag === "Person" ? actor.id : undefined);
      if (admin === undefined) return yield* new AdminRequired();
      return [new OrganisationCreated({ name: cmd.name, admin, ...attributionOf(actor) })];
    }),
    AddMember: Effect.fn(function* (s, cmd) {
      const { members, attribution } = yield* asAdmin(s);
      const role = roleOf(members, cmd.person);
      if (role === cmd.role) return [];
      if (role !== undefined) return yield* new AlreadyMember({ person: cmd.person, role });
      return [new OrganisationMemberAdded({ person: cmd.person, role: cmd.role, ...attribution })];
    }),
    ChangeMemberRole: Effect.fn(function* (s, cmd) {
      const { members, attribution } = yield* asAdmin(s);
      const role = roleOf(members, cmd.person);
      if (role === undefined) return yield* new NotMember({ person: cmd.person });
      if (role === cmd.role) return [];
      if (isLastAdmin(members, cmd.person)) return yield* new LastAdmin();
      return [
        new OrganisationMemberRoleChanged({ person: cmd.person, role: cmd.role, ...attribution }),
      ];
    }),
    RemoveMember: Effect.fn(function* (s, cmd) {
      const { members, attribution } = yield* asAdmin(s);
      if (roleOf(members, cmd.person) === undefined)
        return yield* new NotMember({ person: cmd.person });
      if (isLastAdmin(members, cmd.person)) return yield* new LastAdmin();
      return [new OrganisationMemberRemoved({ person: cmd.person, ...attribution })];
    }),
  },
  evolve: {
    OrganisationCreated: (_, e) => ({
      _tag: "Founded" as const,
      name: e.name,
      members: { [e.admin]: ADMIN_ROLE },
    }),
    OrganisationMemberAdded: (s, e) => withMember(s, e.person, e.role),
    OrganisationMemberRoleChanged: (s, e) => withMember(s, e.person, e.role),
    OrganisationMemberRemoved: (s, e) =>
      s._tag === "Founded" ? { ...s, members: withoutMember(s.members, e.person) } : s,
  },
  read: {
    middleware: [Session],
    rejects: [Forbidden, NotMember],
    validate: Effect.fn(function* (_request, s) {
      const actor = yield* requirePermission(OrganisationsPermissions.read);
      if (actor._tag !== "System" && (s._tag !== "Founded" || !Object.hasOwn(s.members, actor.id)))
        return yield* new NotMember({ person: actor.id });
    }),
  },
}) {}
