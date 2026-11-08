import { Organisation } from "./organisation.aggregate.ts";
import { PersonOrganisations } from "./person-organisations.view.ts";

export { AddMember, AlreadyMember, OrganisationMemberAdded } from "./add-member.command.ts";
export { ChangeMemberRole, OrganisationMemberRoleChanged } from "./change-member-role.command.ts";
export {
  AdminRequired,
  CreateOrganisation,
  OrganisationCreated,
  OrganisationExists,
} from "./create-organisation.command.ts";
export { LastAdmin } from "./last-admin.rejection.ts";
export { NotAdmin } from "./not-admin.rejection.ts";
export { NotMember } from "./not-member.rejection.ts";
export { Organisation, OrganisationState } from "./organisation.aggregate.ts";
export { ADMIN_ROLE, OrgId, RoleName } from "./organisation.id.ts";
export { OrganisationNotFound } from "./organisation-not-found.rejection.ts";
export { OrganisationsPermissions } from "./permissions.ts";
export { NotYourself, PersonOrganisations } from "./person-organisations.view.ts";
export { OrganisationMemberRemoved, RemoveMember } from "./remove-member.command.ts";
export { withMemberships } from "./with-memberships.ts";

export const aggregates = [Organisation] as const;
export const views = [PersonOrganisations] as const;
