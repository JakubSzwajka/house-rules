import { defineWay, Mean, Refused } from "@house-rules/application";
import { Features } from "../../features/index.ts";
import { FirstSignInSlot } from "../../composition/sign-in.ts";

export const firstSignInWay = defineWay({
  protocol: "hook",
  name: "new-login",
  slot: FirstSignInSlot,
  features: [Features.firstSignIn],
  mean: Mean.allow,
  input: (principal) => ({
    issuer: principal.issuer,
    subject: principal.subject,
    displayName:
      typeof principal.claims.name === "string" ? principal.claims.name : principal.subject,
  }),
  failure: () => new Refused({ status: 503, code: "sign_in_failed", message: "Try again." }),
});
