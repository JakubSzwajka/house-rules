import { defineFeature, May, Runtime, runFeature, StepTrace } from "@house-rules/application";
import { Context, Effect, Layer, Option, Schema } from "effect";
import { type memoryAuditLog, CallAudit } from "../index.ts";

export class NameIsEmpty extends Schema.TaggedError<NameIsEmpty>()("NameIsEmpty", {
  kind: Schema.tag("invalid"),
}) {}

export const base = {
  description: "Greet someone by name.",
  input: Schema.Struct({ name: Schema.String }),
  output: Schema.String,
  failure: NameIsEmpty,
  edges: [],
  readOnly: false,
  destructive: false,
  transactional: false,
  needsApproval: false,
} as const;

export const greetHandler = ({
  name,
}: {
  readonly name: string;
}): Effect.Effect<string, NameIsEmpty> =>
  name === "" ? Effect.fail(new NameIsEmpty()) : Effect.succeed(`Hello, ${name}`);

const greeting = (
  name: string,
  permission: "greetings:read" | null,
  handler: typeof greetHandler,
) => {
  const entry = defineFeature(name, {
    ...base,
    permission,
    start: { kind: "system", reason: "audit test", startedBy: "test" },
    handler,
  });
  const runtime = Runtime.layer({
    bindings: [],
    features: [entry],
    ways: [],
  });
  return {
    entry,
    handler: (
      input: typeof base.input.Type,
      allowed: readonly "greetings:read"[] = ["greetings:read"],
    ) =>
      runFeature(entry, input).pipe(
        Effect.provide(
          Layer.mergeAll(
            runtime,
            StepTrace.layer(),
            Layer.succeedContext(
              May.context(May.system([entry]), { system: allowed, via: "test" }),
            ),
          ),
        ),
      ),
  };
};

export const readGreeting = greeting("read_greeting", "greetings:read", greetHandler);
export const publicGreeting = greeting("public_greeting", null, greetHandler);
export const explodingGreeting = greeting("exploding_greeting", null, () =>
  Effect.die("the handler blew up"),
);
export const failThenCleanupDies = greeting("cleanup_dies_greeting", null, () =>
  Effect.fail(new NameIsEmpty()).pipe(Effect.ensuring(Effect.die("cleanup defect"))),
);
export const chattyGreeting = greeting("chatty_greeting", null, (input) =>
  Effect.log("greeting someone").pipe(Effect.andThen(greetHandler(input))),
);
export const stuckGreeting = greeting("stuck_greeting", null, () => Effect.never);
export const slowGreeting = greeting("slow_greeting", null, (input) =>
  Effect.sleep("50 millis").pipe(Effect.andThen(greetHandler(input))),
);

export class Requester extends Context.Service<Requester, { readonly userId: string }>()(
  "test/Requester",
) {}
export const ANA = { userId: "user_ana" };
export const who = Effect.serviceOption(Requester).pipe(
  Effect.map((viewer) => (Option.isSome(viewer) ? viewer.value.userId : null)),
);
export const audited = (log: ReturnType<typeof memoryAuditLog>) =>
  Layer.mergeAll(CallAudit.record.memory(log, { who }).layer, Layer.succeed(Requester, ANA));
