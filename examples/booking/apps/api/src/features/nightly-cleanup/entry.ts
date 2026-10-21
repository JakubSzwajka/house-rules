import { defineEntry } from "@house-rules/application/contract";
import { nightlyCleanupNode } from "./node.ts";
export const nightlyCleanupEntry = defineEntry(nightlyCleanupNode, {
  start: { kind: "system", reason: "nightly cleanup", startedBy: "schedule:nightly_cleanup" },
});
