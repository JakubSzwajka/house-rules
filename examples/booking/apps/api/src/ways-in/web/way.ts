import { Features } from "../../features/index.ts";
import { webWho } from "../../composition/callers.ts";
import { defineWay, Mean } from "@house-rules/application";
import { endpoints } from "./endpoints.ts";
const features = [
  Features.createOrganisation,
  Features.myOrganisations,
  Features.createInvitation,
  Features.acceptInvitation,
  Features.listInvitations,
  Features.revokeInvitation,
  Features.removeMember,
  Features.listPeople,
  Features.listMembers,
  Features.myActivity,
  Features.myProfile,
  Features.listPermissions,
  Features.recentAudit,
  Features.deleteRole,
  Features.signUp,
  Features.signIn,
  Features.signOut,
  Features.changePassword,
  Features.makeBooking,
  Features.showBooking,
  Features.myBookings,
  Features.cancelBooking,
  Features.defineRole,
  Features.listRoles,
  Features.assignRole,
  Features.revokeRole,
] as const;
export const webWay = defineWay({
  name: "web",
  path: "/api",
  protocol: "http",
  features,
  endpoints,
  who: webWho,
  public: [Features.signUp, Features.signIn],
  session: { cookie: "booking_session" },
  origins: ["http://localhost:3000", "https://booking.example"],
  mean: Mean.allow,
});
