import { makeBooking } from "./make-booking/index.ts";
import { cancelBooking } from "./cancel-booking/index.ts";
import { firstSignIn } from "./first-sign-in/index.ts";
import { duePayments } from "./due-payments/index.ts";
import { expirePayment } from "./expire-payment/index.ts";
import { defineRole } from "./define-role/index.ts";
import { listRoles } from "./list-roles/index.ts";
import { assignRole } from "./assign-role/index.ts";
import { revokeRole } from "./revoke-role/index.ts";
import { signUp } from "./sign-up/index.ts";
import { signIn } from "./sign-in/index.ts";
import { signOut } from "./sign-out/index.ts";
import { changePassword } from "./change-password/index.ts";
import { myProfile } from "./my-profile/index.ts";
import { listPermissions } from "./list-permissions/index.ts";
import { recentAudit } from "./recent-audit/index.ts";
import { deleteRole } from "./delete-role/index.ts";
import { createOrganisation } from "./create-organisation/index.ts";
import { myOrganisations } from "./my-organisations/index.ts";
import { createInvitation } from "./create-invitation/index.ts";
import { acceptInvitation } from "./accept-invitation/index.ts";
import { listInvitations } from "./list-invitations/index.ts";
import { revokeInvitation } from "./revoke-invitation/index.ts";
import { removeMember } from "./remove-member/index.ts";
import { listPeople } from "./list-people/index.ts";
import { listMembers } from "./list-members/index.ts";
import { myActivity } from "./my-activity/index.ts";
export const Features = {
  createOrganisation,
  myOrganisations,
  createInvitation,
  acceptInvitation,
  listInvitations,
  revokeInvitation,
  removeMember,
  listPeople,
  listMembers,
  myActivity,
  myProfile,
  listPermissions,
  recentAudit,
  deleteRole,
  signUp,
  signIn,
  signOut,
  changePassword,
  makeBooking: makeBooking,
  cancelBooking: cancelBooking,
  firstSignIn: firstSignIn,
  duePayments: duePayments,
  expirePayment: expirePayment,
  defineRole: defineRole,
  listRoles: listRoles,
  assignRole: assignRole,
  revokeRole: revokeRole,
} as const;
