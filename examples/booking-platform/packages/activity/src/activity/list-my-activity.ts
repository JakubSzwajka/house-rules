import { defineContract } from "@house-rules/application/contract";
import { ActivityQuery, ActivityUnavailable, MyActivity } from "./activity.js";
import { ActivityPermissions } from "./permissions.js";

export const listMyActivityContract = defineContract("list_my_activity", {
  description:
    "List the signed-in user's own calls that call-audit kept, newest first, 20 at a time. " +
    "Pass the page's next cursor (beforeAt and skipAtSameTime) back for older ones. " +
    "Reads of this list are left out unless includeActivityReads is true.",
  input: ActivityQuery,
  output: MyActivity,
  failure: ActivityUnavailable,
  permission: ActivityPermissions.read,
  annotations: { readOnly: true },
});
