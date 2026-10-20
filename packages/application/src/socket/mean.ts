import type { Layer } from "effect";
import { Approval } from "../gates/approval.ts";
import { elicitationApproval } from "../gates/elicitation-approval.ts";

export interface MeanSocket {
  readonly approval: Layer.Layer<Approval>;
}
export const Mean = {
  no: { approval: Approval.denyAll },
  elicitation: { approval: elicitationApproval },
  allow: { approval: Approval.allowAll },
} satisfies Record<string, MeanSocket>;
