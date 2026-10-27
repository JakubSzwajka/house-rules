import { showBooking } from "./show-booking/index.ts";
import { myBookings } from "./my-bookings/index.ts";
import { duePayments } from "./due-payments/index.ts";
import { listInvitations } from "./list-invitations/index.ts";
import { listMembers } from "./list-members/index.ts";
import { listPeople } from "./list-people/index.ts";
import { listPermissions } from "./list-permissions/index.ts";
import { listRoles } from "./list-roles/index.ts";
import { myActivity } from "./my-activity/index.ts";
import { myOrganisations } from "./my-organisations/index.ts";
import { myProfile } from "./my-profile/index.ts";
import { recentAudit } from "./recent-audit/index.ts";
export const ReadModels = {
  showBooking,
  myBookings,
  duePayments,
  listInvitations,
  listMembers,
  listPeople,
  listPermissions,
  listRoles,
  myActivity,
  myOrganisations,
  myProfile,
  recentAudit,
} as const;
