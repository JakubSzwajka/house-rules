import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import type { Actor } from "../actor/actor.ts";
import { CurrentActor } from "../actor/current-actor.context.ts";
import { ApprovalGate, ApprovalRequired } from "./approval-gate.middleware.ts";

export interface ApprovalRequest {
  readonly command: string;
  readonly actor: Actor;
}

export const isAgent = (actor: Actor): boolean => actor._tag === "Person" && actor.via === "agent";

const policy = (approves: (request: ApprovalRequest) => boolean): Layer.Layer<ApprovalGate> =>
  Layer.succeed(ApprovalGate, (effect, { rpc }) =>
    Effect.flatMap(
      Effect.serviceOption(CurrentActor),
      Option.match({
        onNone: () =>
          Effect.logWarning(
            "ApprovalGate ran before Session: list it as [ApprovalGate, Session]",
          ).pipe(Effect.andThen(Effect.fail(new ApprovalRequired({ command: rpc._tag })))),
        onSome: (actor) =>
          approves({ command: rpc._tag, actor })
            ? effect
            : Effect.fail(new ApprovalRequired({ command: rpc._tag })),
      }),
    ),
  );

export const Approval = {
  policy,
  denyAgents: policy(({ actor }) => !isAgent(actor)),
  allowAll: policy(() => true),
};
