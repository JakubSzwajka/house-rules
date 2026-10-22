import { toPromiseClient, type CallReport } from "@house-rules/application/contract";
import { api } from "../endpoints.ts";
export type CallRow = CallReport & { message: string };
export const makeClient = (onCall: (row: CallRow) => void) =>
  toPromiseClient(api, {
    onCall: (report) =>
      onCall({ ...report, message: report.status < 400 ? "OK" : "Request failed" }),
  });
export type Client = ReturnType<typeof makeClient>;
export type Action = keyof Client;
export const clearsCallHistory = (action: Action, previousId?: string, nextId?: string) =>
  action === "signIn" ||
  action === "signUp" ||
  action === "signOut" ||
  (action === "myProfile" && previousId !== nextId);
export const approvalNeeded = (action: Action) => api.endpoints[action].feature.needsApproval;
