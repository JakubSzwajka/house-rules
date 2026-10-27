import { Features } from "../../features/index.ts";
import { ReadModels } from "../../read-models/index.ts";
import { endpoint, defineApi } from "@house-rules/application/contract";
export const api = defineApi(
  { prefix: "/api" },
  {
    createOrganisation: endpoint(Features.createOrganisation),
    myOrganisations: endpoint(ReadModels.myOrganisations),
    createInvitation: endpoint(Features.createInvitation),
    acceptInvitation: endpoint(Features.acceptInvitation),
    listInvitations: endpoint(ReadModels.listInvitations),
    revokeInvitation: endpoint(Features.revokeInvitation),
    removeMember: endpoint(Features.removeMember),
    listPeople: endpoint(ReadModels.listPeople),
    listMembers: endpoint(ReadModels.listMembers),
    myActivity: endpoint(ReadModels.myActivity),
    myProfile: endpoint(ReadModels.myProfile),
    listPermissions: endpoint(ReadModels.listPermissions),
    recentAudit: endpoint(ReadModels.recentAudit),
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
    listRoles: endpoint(ReadModels.listRoles),
    assignRole: endpoint(Features.assignRole),
    revokeRole: endpoint(Features.revokeRole),
  },
);
export const endpoints = Object.values(api.endpoints);
