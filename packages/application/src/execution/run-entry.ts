import {
  type KindedError,
  type NoOpenUnit,
  type SystemCaller,
  UnitOfWork,
  type UnitOfWorkFailed,
} from "@house-rules/domain";
import { Effect, Option, Schema } from "effect";
import { NoOpenUnit as NoOpenUnitSchema } from "@house-rules/domain";
import { CurrentActor } from "../actor/current-actor.ts";
import { callFactsOf, CallRequestId } from "../call/call-facts.ts";
import { CallWatch } from "../call/call-watch.ts";
import { Approval } from "../gates/approval.ts";
import { type ApprovalDenied, Forbidden } from "../gates/gate-errors.ts";
import type { InnerFailure } from "../node/binding.ts";
import { NodeCallInvalid } from "../node/node-call-invalid.ts";
import { NodeRuntime } from "../node/node-runtime.ts";
import { CallPermissions } from "../socket/permission-lists.ts";
import { StepTrace } from "../trace/step-trace.ts";
import type { AnyEntry } from "../entry/entry.ts";

export type EntryFailure<E extends AnyEntry> =
  | Exclude<
      E["node"]["failure"]["Type"] | InnerFailure,
      E["transactional"] extends true ? NoOpenUnit : never
    >
  | Forbidden
  | (E["needsApproval"] extends false ? never : ApprovalDenied)
  | (E["transactional"] extends false ? never : UnitOfWorkFailed);
export type EntryRequirements<E extends AnyEntry> =
  | NodeRuntime
  | CallPermissions
  | StepTrace
  | (E["start"] extends SystemCaller ? never : CurrentActor)
  | (E["transactional"] extends false ? never : UnitOfWork)
  | (E["needsApproval"] extends false ? never : Approval);

export function runEntry<E extends AnyEntry>(
  entry: E,
  input: E["node"]["input"]["Type"],
): Effect.Effect<E["node"]["output"]["Type"], EntryFailure<E>, EntryRequirements<E>>;
export function runEntry(
  entry: AnyEntry,
  input: AnyEntry["node"]["input"]["Type"],
): Effect.Effect<
  unknown,
  KindedError,
  NodeRuntime | CallPermissions | StepTrace | UnitOfWork | Approval
> {
  const work = Effect.gen(function* () {
    const watch = yield* CallWatch;
    const run = Effect.gen(function* () {
      const permissions = yield* CallPermissions;
      if (!permissions.entries.includes(entry))
        return yield* new NodeCallInvalid({
          node: entry.node.name,
          reason: "Entry is not exposed by this way",
        });
      const trace = yield* StepTrace;
      const requestId = yield* CallRequestId;
      for (const caller of ["person", "system"] as const) {
        for (const permission of entry.closures[caller]) {
          if (!permissions[caller].includes(permission)) {
            yield* trace.refuse(requestId, { entry: entry.node.name, permission, caller });
            return yield* new Forbidden({ entry: entry.node.name, permission, caller });
          }
        }
      }
      if (entry.needsApproval) yield* (yield* Approval).approve(entry.node.name, input);
      const nodes = Effect.gen(function* () {
        const runtime = yield* NodeRuntime;
        if (entry.start !== "person")
          return yield* runtime.run(entry.node, input, entry.start, entry.node.name);
        const actor = yield* Effect.serviceOption(CurrentActor);
        if (Option.isNone(actor))
          return yield* new NodeCallInvalid({
            node: entry.node.name,
            reason: "Person entry requires CurrentActor",
          });
        return yield* runtime.run(
          entry.node,
          input,
          { kind: "person", actor: actor.value, via: permissions.via },
          entry.node.name,
        );
      });
      return yield* entry.transactional
        ? UnitOfWork.atomic(nodes.pipe(Effect.catchIf(Schema.is(NoOpenUnitSchema), Effect.die)))
        : nodes;
    });
    const facts = yield* callFactsOf(entry);
    return yield* watch.around(entry, input, run, facts);
  });
  return work;
}
