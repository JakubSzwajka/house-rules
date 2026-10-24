import type { Permission } from "@house-rules/domain";
import { Context, Effect, Layer } from "effect";

export type Step = Readonly<{
  order: number;
  feature: string;
  target: string;
  caller: "person" | "system";
  reason: string | null;
  causedBy?: string | null;
  outcome: "running" | "success" | "failure";
}>;
export type ClosureRefusal = Readonly<{
  feature: string;
  permission: Permission;
  caller: "person" | "system";
}>;
export type TraceSnapshot = Readonly<{
  steps: readonly Step[];
  refusals: readonly ClosureRefusal[];
}>;
export type StepTraceOptions = Readonly<{ maxRequests?: number }>;

const traceBound = (options: StepTraceOptions = {}): number => {
  const max = options.maxRequests ?? 1000;
  if (!Number.isSafeInteger(max) || max <= 0)
    throw new RangeError("maxRequests must be a positive safe integer");
  return max;
};

export class StepTrace extends Context.Service<
  StepTrace,
  {
    begin: (id: string | null, step: Omit<Step, "order" | "outcome">) => Effect.Effect<number>;
    finish: (
      id: string | null,
      order: number,
      outcome: "success" | "failure",
    ) => Effect.Effect<void>;
    refuse: (id: string | null, refusal: ClosureRefusal) => Effect.Effect<void>;
    read: (id: string | null) => Effect.Effect<TraceSnapshot>;
  }
>()("@house-rules/application/StepTrace") {
  static readonly make = (options?: StepTraceOptions): StepTrace["Service"] =>
    StepTrace.allocate(traceBound(options));

  private static readonly allocate = (max: number): StepTrace["Service"] => {
    const traces = new Map<string | null, { steps: Step[]; refusals: ClosureRefusal[] }>();
    const get = (id: string | null) => {
      let trace = traces.get(id);
      if (trace === undefined) {
        trace = { steps: [], refusals: [] };
        traces.set(id, trace);
        if (traces.size > max) {
          const first = traces.keys().next();
          if (!first.done) traces.delete(first.value);
        }
      }
      return trace;
    };
    return {
      begin: (id, step) =>
        Effect.sync(() => {
          const trace = get(id);
          const order = trace.steps.length + 1;
          trace.steps.push({ ...step, order, outcome: "running" });
          return order;
        }),
      finish: (id, order, outcome) =>
        Effect.sync(() => {
          const trace = traces.get(id);
          const step = trace?.steps[order - 1];
          if (trace !== undefined && step !== undefined)
            trace.steps[order - 1] = { ...step, outcome };
        }),
      refuse: (id, refusal) =>
        Effect.sync(() => {
          get(id).refusals.push({ ...refusal });
        }),
      read: (id) =>
        Effect.sync(() => {
          const trace = traces.get(id);
          return {
            steps: trace?.steps.map((step) => ({ ...step })) ?? [],
            refusals: trace?.refusals.map((refusal) => ({ ...refusal })) ?? [],
          };
        }),
    };
  };
  static readonly layer = (options?: StepTraceOptions): Layer.Layer<StepTrace> => {
    const max = traceBound(options);
    return Layer.sync(StepTrace, () => StepTrace.allocate(max));
  };
}
