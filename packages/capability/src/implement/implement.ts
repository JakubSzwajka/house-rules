import { Effect } from "effect";
import { Approval } from "../gates/approval.ts";
import { callFactsOf } from "../call/call-facts.ts";
import { CallWatch } from "../call/call-watch.ts";
import type { AnyContract, FailureOf, GateRequirements } from "../contract/contract.ts";
import { Forbidden } from "../gates/gate-errors.ts";
import { Grant } from "../gates/grant.ts";
import { UnitOfWork } from "../unit-of-work/unit-of-work.ts";

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
  const { name, permission, needsApproval, transactional } = contract;
  const gated = (input: Contract["input"]["Type"]) =>
    Effect.gen(function* watchedCall() {
      const watch = yield* CallWatch;
      const run = Effect.gen(function* gatedHandler() {
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
        return yield* transactional ? UnitOfWork.atomic(handler(input)) : handler(input);
      });
      const facts = yield* callFactsOf(contract, input);
      return yield* watch.around(contract, input, run, facts);
    });
  // The runtime branches read the same permission, needsApproval and transactional the contract type carries.
  return { _tag: "Capability", contract, handler: gated } as Capability<Contract, Requirements>;
};
