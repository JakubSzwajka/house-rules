import { defineWay, Mean } from "@house-rules/application";
import { Features } from "../../features/index.ts";
import { ReadModels } from "../../read-models/index.ts";
export const nightlyCleanupWay = defineWay({
  protocol: "schedule",
  name: "nightly-cleanup",
  clock: { cron: "0 3 * * *", timeZone: "UTC" },
  features: [ReadModels.duePayments, Features.expirePayment],
  mean: Mean.allow,
  input: {},
});
