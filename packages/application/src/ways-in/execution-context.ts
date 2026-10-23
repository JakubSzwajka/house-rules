import { UnitOfWork, type Permission } from "@house-rules/domain";
import { Context, Effect, Layer } from "effect";
import { HttpServerRequest } from "effect/http";
import { CallChannel } from "../call/call-facts.ts";
import { CallWatch } from "../call/call-watch.ts";
import { Approval } from "../gates/approval.ts";
import { Runtime } from "../runtime/runtime.ts";
import { May } from "../socket/may.ts";
import { StepTrace } from "../trace/step-trace.ts";
import type { HookWay, ScheduleWay } from "./way.ts";
import { CallerScope } from "./caller-scope.ts";

const credentialHeaders = ["authorization", "cookie", "proxy-authorization", "set-cookie"];

export const executionContext = <R>(context: Context.Context<R>): Context.Context<R> => {
  // Omit the request, not just its headers: its source can retain the original web Request.
  const clean = Context.omit(HttpServerRequest.HttpServerRequest)(context) as Context.Context<R>;
  const scope = Context.getOrUndefined(context, CallerScope);
  if (scope === undefined) return clean;
  const headers = new Headers(scope.incoming.headers);
  for (const name of credentialHeaders) headers.delete(name);
  return Context.add(clean, CallerScope, {
    ...scope,
    incoming: { ...scope.incoming, headers },
  }) as Context.Context<R>;
};

export const systemExecutionContext = (
  way: Pick<
    HookWay<any, any, any, any> | ScheduleWay<any, any>,
    "protocol" | "name" | "features" | "mean"
  >,
  system: readonly Permission[],
) =>
  Effect.gen(function* () {
    const runtime = yield* Runtime;
    const trace = yield* StepTrace;
    const unit = yield* UnitOfWork;
    const watch = yield* CallWatch;
    const approval = Context.get(yield* Layer.build(way.mean.approval), Approval);
    return Context.make(Runtime, runtime).pipe(
      Context.add(StepTrace, trace),
      Context.add(UnitOfWork, unit),
      Context.add(CallWatch, watch),
      Context.add(Approval, approval),
      Context.add(CallChannel, `${way.protocol}:${way.name}`),
      Context.merge(May.system(way.features, { system, via: `${way.protocol}:${way.name}` })),
    );
  });
