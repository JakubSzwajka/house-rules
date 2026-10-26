import { Features } from "../../features/index.ts";
import { ReadModels } from "../../read-models/index.ts";
import { endpoint, defineApi } from "@house-rules/application/contract";
export const api = defineApi(
  { prefix: "/api" },
  {
    createOrganisation: endpoint(Features.createOrganisation),
    myOrganisations: endpoint(Features.myOrganisations),
    createInvitation: endpoint(Features.createInvitation),
    acceptInvitation: endpoint(Features.acceptInvitation),
    listInvitations: endpoint(Features.listInvitations),
    revokeInvitation: endpoint(Features.revokeInvitation),
    removeMember: endpoint(Features.removeMember),
    listPeople: endpoint(Features.listPeople),
    listMembers: endpoint(Features.listMembers),
    myActivity: endpoint(Features.myActivity),
    myProfile: endpoint(Features.myProfile),
    listPermissions: endpoint(Features.listPermissions),
    recentAudit: endpoint(Features.recentAudit),
    deleteRole: endpoint(Features.deleteRole),
    signUp: endpoint(Features.signUp, undefined, { session: "issue" }),
    signIn: endpoint(Features.signIn, undefined, { session: "issue" }),
    signOut: endpoint(Features.signOut, undefined, { session: "clear" }),
    changePassword: endpoint(Features.changePassword),
    makeBooking: endpoint(Features.makeBooking),
    showBooking: endpoint(ReadModels.showBooking),
    myBookings: endpoint(ReadModels.myBookings),
    cancelBooking: endpoint(Features.cancelBooking),
    defineRole: endpoint(Features.defineRole),
    listRoles: endpoint(Features.listRoles),
    assignRole: endpoint(Features.assignRole),
    revokeRole: endpoint(Features.revokeRole),
  },
);
export const endpoints = Object.values(api.endpoints);
