import { makeBooking } from "./make-booking/index.ts";
import { cancelBooking } from "./cancel-booking/index.ts";
import { firstSignIn } from "./first-sign-in/index.ts";
import { expirePayment } from "./expire-payment/index.ts";
import { defineRole } from "./define-role/index.ts";
import { assignRole } from "./assign-role/index.ts";
import { revokeRole } from "./revoke-role/index.ts";
import { signUp } from "./sign-up/index.ts";
import { signIn } from "./sign-in/index.ts";
import { signOut } from "./sign-out/index.ts";
import { changePassword } from "./change-password/index.ts";
import { deleteRole } from "./delete-role/index.ts";
import { createOrganisation } from "./create-organisation/index.ts";
import { createInvitation } from "./create-invitation/index.ts";
import { acceptInvitation } from "./accept-invitation/index.ts";
import { revokeInvitation } from "./revoke-invitation/index.ts";
import { removeMember } from "./remove-member/index.ts";
export const Features = {
  createOrganisation,
  createInvitation,
  acceptInvitation,
  revokeInvitation,
  removeMember,
  deleteRole,
  signUp,
  signIn,
  signOut,
  changePassword,
  makeBooking: makeBooking,
  cancelBooking: cancelBooking,
  firstSignIn: firstSignIn,
  expirePayment: expirePayment,
  defineRole: defineRole,
  assignRole: assignRole,
  revokeRole: revokeRole,
} as const;
