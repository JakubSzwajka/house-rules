import { Cause, Effect, Layer, Option, Result, Schema } from "effect";
import { McpSchema, McpServer } from "effect/unstable/ai";
import { Approval } from "./approval.ts";
import { ApprovalDenied } from "./gate-errors.ts";

export const ApprovalForm = Schema.Struct({
  approve: Schema.Boolean.annotate({
    title: "Approve",
    description: "Run this action now.",
  }),
});

const inputAsJson = (input: unknown): string =>
  JSON.stringify(
    input,
    (_key, value: unknown) => (typeof value === "bigint" ? value.toString() : value),
    2,
  ) ?? "null";

export const approvalMessage = (capabilityName: string, input: unknown): string =>
  [
    `An agent asks to run "${capabilityName}".`,
    "Its input, as data:",
    inputAsJson(input),
    "Approve this call?",
  ].join("\n");

const canAskForForm = (capabilities: McpSchema.ClientCapabilities): boolean => {
  const { elicitation } = capabilities;
  if (elicitation === undefined) {
    return false;
  }
  // An empty elicitation object means form mode in MCP 2025-06-18.
  return elicitation.form !== undefined || elicitation.url === undefined;
};

const isMalformedAnswer = <E>(cause: Cause.Cause<E>): boolean => {
  const defect = Cause.findDefect(cause);
  return Result.isSuccess(defect) && Schema.isSchemaError(defect.success);
};

const approveByElicitation = (
  capabilityName: string,
  input: unknown,
): Effect.Effect<void, ApprovalDenied> =>
  Effect.gen(function* approveByElicitationGate() {
    const denied = (reason: string) => new ApprovalDenied({ capabilityName, reason });
    const client = yield* Effect.serviceOption(McpSchema.McpServerClient);
    if (Option.isNone(client) || !canAskForForm(client.value.clientCapabilities)) {
      return yield* denied("The MCP client cannot ask a human for approval");
    }
    const answer = yield* McpServer.elicit({
      message: approvalMessage(capabilityName, input),
      schema: ApprovalForm,
    }).pipe(
      Effect.provideService(McpSchema.McpServerClient, client.value),
      Effect.catchTag("ElicitationDeclined", () => Effect.fail(denied("Approval was declined"))),
      Effect.catchCauseIf(Cause.hasInterruptsOnly, () =>
        Effect.fail(denied("Approval was cancelled")),
      ),
      // McpServer.elicit dies with a SchemaError on malformed accepted content.
      Effect.catchCauseIf(isMalformedAnswer, () =>
        Effect.fail(denied("Approval answer was malformed")),
      ),
    );
    if (!answer.approve) {
      return yield* denied("Approval was answered no");
    }
  });

export const elicitationApproval: Layer.Layer<Approval> = Layer.succeed(Approval, {
  approve: approveByElicitation,
});
