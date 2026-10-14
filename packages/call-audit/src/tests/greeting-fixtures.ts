import { defineContract, Grant, implement } from "@house-rules/application";
import { Context, Effect, Layer, Option, Schema } from "effect";
import { type memoryAuditLog, CallAudit } from "../index.ts";

export class NameIsEmpty extends Schema.TaggedError<NameIsEmpty>()("NameIsEmpty", {}) {}

export const base = {
  description: "Greet someone by name.",
  input: Schema.Struct({ name: Schema.String }),
  output: Schema.String,
  failure: NameIsEmpty,
};

export const greetHandler = ({ name }: { readonly name: string }) =>
  name === "" ? Effect.fail(new NameIsEmpty()) : Effect.succeed(`Hello, ${name}`);

export const readGreeting = implement(
  defineContract("read_greeting", { ...base, permission: "greetings:read" }),
  greetHandler,
);
export const publicGreeting = implement(
  defineContract("public_greeting", { ...base, permission: "public" }),
  greetHandler,
);
export const explodingGreeting = implement(
  defineContract("exploding_greeting", { ...base, permission: "public" }),
  () => Effect.die("the handler blew up"),
);
export const failThenCleanupDies = implement(
  defineContract("cleanup_dies_greeting", { ...base, permission: "public" }),
  () => Effect.fail(new NameIsEmpty()).pipe(Effect.ensuring(Effect.die("cleanup defect"))),
);
export const chattyGreeting = implement(
  defineContract("chatty_greeting", { ...base, permission: "public" }),
  (input) => Effect.log("greeting someone").pipe(Effect.andThen(greetHandler(input))),
);
export const stuckGreeting = implement(
  defineContract("stuck_greeting", { ...base, permission: "public" }),
  () => Effect.never,
);
export const slowGreeting = implement(
  defineContract("slow_greeting", { ...base, permission: "public" }),
  (input) => Effect.sleep("50 millis").pipe(Effect.andThen(greetHandler(input))),
);

export class Requester extends Context.Service<Requester, { readonly userId: string }>()(
  "test/Requester",
) {}

export const ANA = { userId: "user_ana" };

export const who = Effect.serviceOption(Requester).pipe(
  Effect.map((viewer) => (Option.isSome(viewer) ? viewer.value.userId : null)),
);

export const audited = (log: ReturnType<typeof memoryAuditLog>) =>
  Layer.mergeAll(
    CallAudit.layerMemory(log, { who }),
    Layer.succeed(Requester, ANA),
    Grant.layerFromPermissions(["greetings:read"]),
  );
