import { Effect } from "effect";
import { Approval } from "./approval.ts";
import type { AnyContract, FailureOf, GateRequirements } from "./contract.ts";
import { Forbidden } from "./gate-errors.ts";
import { Grant } from "./grant.ts";

export type HandlerOf<Contract extends AnyContract, Requirements = never> = (
  input: Contract["input"]["Type"],
) => Effect.Effect<Contract["output"]["Type"], Contract["failure"]["Type"], Requirements>;

export type Capability<Contract extends AnyContract, Requirements = never> = Readonly<{
  _tag: "Capability";
  contract: Contract;
  handler: (
    input: Contract["input"]["Type"],
  ) => Effect.Effect<
    Contract["output"]["Type"],
    FailureOf<Contract>["Type"],
    Requirements | GateRequirements<Contract>
  >;
}>;

export const implement = <Contract extends AnyContract, Requirements = never>(
  contract: Contract,
  handler: HandlerOf<Contract, Requirements>,
): Capability<Contract, Requirements> => {
  const { name, permission, needsApproval } = contract;
  const gated = (input: Contract["input"]["Type"]) =>
    Effect.gen(function* gatedHandler() {
      if (permission !== "public") {
        const grant = yield* Grant;
        if (!(yield* grant.holds(permission))) {
          return yield* new Forbidden({ capabilityName: name, permission });
        }
      }
      if (needsApproval) {
        const approval = yield* Approval;
        yield* approval.approve(name, input);
      }
      return yield* handler(input);
    });
  // The runtime branches read the same permission and needsApproval the contract type carries.
  return { _tag: "Capability", contract, handler: gated } as Capability<Contract, Requirements>;
};
