import { Features } from "../../features/index.ts";
import { ReadModels } from "../../read-models/index.ts";
import { webWho } from "../../composition/sign-in.ts";
import { defineWay, Mean } from "@house-rules/application";
import { endpoints } from "./endpoints.ts";
const features = [
  Features.createOrganisation,
  ReadModels.myOrganisations,
  Features.createInvitation,
  Features.acceptInvitation,
  ReadModels.listInvitations,
  Features.revokeInvitation,
  Features.removeMember,
  ReadModels.listPeople,
  ReadModels.listMembers,
  ReadModels.myActivity,
  ReadModels.myProfile,
  ReadModels.listPermissions,
  ReadModels.recentAudit,
  Features.deleteRole,
  Features.signUp,
  Features.signIn,
  Features.signOut,
  Features.changePassword,
  Features.makeBooking,
  ReadModels.showBooking,
  ReadModels.myBookings,
  Features.cancelBooking,
  Features.defineRole,
  ReadModels.listRoles,
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
