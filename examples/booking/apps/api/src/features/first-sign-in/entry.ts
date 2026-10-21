import { defineEntry } from "@house-rules/application/contract";
import { firstSignInNode } from "./node.ts";
export const firstSignInEntry = defineEntry(firstSignInNode, {
  start: { kind: "system", reason: "new login", startedBy: "hook:new-login" },
});
