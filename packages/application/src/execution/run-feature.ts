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
import type { InnerFailure } from "../runtime/binding.ts";
import { CallInvalid } from "../runtime/call-invalid.ts";
import { Runtime } from "../runtime/runtime.ts";
import { CallPermissions } from "../socket/permission-lists.ts";
import { MayUnavailable } from "../socket/may-unavailable.ts";
import { StepTrace } from "../trace/step-trace.ts";
import { type AnyEntryPoint, isEntryPoint } from "../feature/feature.ts";

export type FeatureFailure<E extends AnyEntryPoint> =
  | Exclude<
      E["failure"]["Type"] | InnerFailure,
      E["transactional"] extends true ? NoOpenUnit : never
    >
  | Forbidden
  | MayUnavailable
  | (E["needsApproval"] extends false ? never : ApprovalDenied)
  | (E["transactional"] extends false ? never : UnitOfWorkFailed);
export type FeatureRequirements<E extends AnyEntryPoint> =
  | Runtime
  | CallPermissions
  | StepTrace
  | (E["start"] extends SystemCaller ? never : CurrentActor)
  | (E["transactional"] extends false ? never : UnitOfWork)
  | (E["needsApproval"] extends false ? never : Approval);

export function runFeature<E extends AnyEntryPoint>(
  feature: E,
  input: E["input"]["Type"],
): Effect.Effect<E["output"]["Type"], FeatureFailure<E>, FeatureRequirements<E>>;
export function runFeature(
  feature: AnyEntryPoint,
  input: AnyEntryPoint["input"]["Type"],
): Effect.Effect<
  unknown,
  KindedError,
  Runtime | CallPermissions | StepTrace | UnitOfWork | Approval
> {
  const work = Effect.gen(function* () {
    const featureName = feature.name;
    if (!isEntryPoint(feature))
      return yield* new CallInvalid({
        callable: featureName,
        reason: "Feature was not created by defineFeature",
      });
    const watch = yield* CallWatch;
    const run = Effect.gen(function* () {
      const permissions = yield* CallPermissions;
      if (!permissions.features.includes(feature))
        return yield* new CallInvalid({
          callable: feature.name,
          reason: "Feature is not exposed by this way",
        });
      let person = permissions.person;
      if (feature.start === "person") {
        const actor = yield* Effect.serviceOption(CurrentActor);
        if (Option.isNone(actor))
          return yield* new CallInvalid({
            callable: feature.name,
            reason: "Person feature requires CurrentActor",
          });
        person = yield* permissions.may.permissionsOf({
          kind: "person",
          actor: actor.value,
          via: permissions.via,
        });
      }
      const held = { ...permissions, person };
      const trace = yield* StepTrace;
      const requestId = yield* CallRequestId;
      for (const caller of ["person", "system"] as const) {
        for (const permission of feature.closures[caller]) {
          if (!held[caller].includes(permission)) {
            yield* trace.refuse(requestId, { feature: feature.name, permission, caller });
            return yield* new Forbidden({ feature: feature.name, permission, caller });
          }
        }
      }
      if (feature.needsApproval) yield* (yield* Approval).approve(feature.name, input);
      const callables = Effect.gen(function* () {
        const runtime = yield* Runtime;
        if (feature.start !== "person")
          return yield* runtime.run(feature, input, feature.start, feature.name);
        const actor = yield* Effect.serviceOption(CurrentActor);
        if (Option.isNone(actor))
          return yield* new CallInvalid({
            callable: feature.name,
            reason: "Person feature requires CurrentActor",
          });
        return yield* runtime.run(
          feature,
          input,
          { kind: "person", actor: actor.value, via: permissions.via },
          feature.name,
        );
      });
      const execution = feature.transactional
        ? UnitOfWork.atomic(callables.pipe(Effect.catchIf(Schema.is(NoOpenUnitSchema), Effect.die)))
        : callables;
      return yield* execution.pipe(Effect.provideService(CallPermissions, held));
    });
    const facts = yield* callFactsOf(feature);
    return yield* watch.around(feature, input, run, facts);
  });
  return work;
}
