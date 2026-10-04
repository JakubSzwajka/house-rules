import { Effect, Layer, Option, Result } from "effect";
import { McpSchema } from "effect/unstable/ai";
import { Approval } from "./approval.ts";
import { ApprovalDenied } from "./gate-errors.ts";

export const ApprovalForm = { type: "object", properties: {} } as const;

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

const safeTag = /^[A-Za-z][A-Za-z0-9_]{0,39}$/u;

const safeIdentifierOf = (error: unknown): string | undefined => {
  if (typeof error !== "object" || error === null) {
    return undefined;
  }
  const record = error as Record<string, unknown>;
  const constructorName: unknown = Object.getPrototypeOf(error)?.constructor?.name;
  return [record["_tag"], constructorName, record["name"]].find(
    (candidate): candidate is string =>
      typeof candidate === "string" && candidate !== "Object" && safeTag.test(candidate),
  );
};

const failureReason = (error: unknown): string => {
  const tag = safeIdentifierOf(error);
  return tag === undefined ? "Approval request failed" : `Approval request failed (${tag})`;
};

const askHuman = (
  capabilityName: string,
  input: unknown,
  client: McpSchema.McpServerClient["Service"],
): Effect.Effect<void, ApprovalDenied> => {
  const denied = (reason: string) => new ApprovalDenied({ capabilityName, reason });
  const failed = (error: unknown) => denied(failureReason(error));
  return Effect.gen(function* askHumanGate() {
    const reverse = yield* client.getClient;
    const request = new McpSchema.ElicitRequestFormParams({
      mode: "form",
      message: approvalMessage(capabilityName, input),
      requestedSchema: ApprovalForm,
    });
    const answer = yield* reverse.elicit(request).pipe(
      Effect.mapError(failed),
      Effect.catchDefect((defect) => Effect.fail(failed(defect))),
    );
    const action =
      typeof answer === "object" && answer !== null
        ? (answer as { readonly action?: unknown }).action
        : undefined;
    switch (action) {
      case "accept":
        return;
      case "decline":
        return yield* denied("Approval was declined");
      case "cancel":
        return yield* denied("Approval was cancelled");
      default:
        return yield* denied("Approval answer was malformed");
    }
  }).pipe(Effect.scoped);
};

const approveByElicitation = (
  capabilityName: string,
  input: unknown,
): Effect.Effect<void, ApprovalDenied> =>
  Effect.gen(function* approveByElicitationGate() {
    const client = yield* Effect.serviceOption(McpSchema.McpServerClient);
    const formElicitation = Option.isSome(client) && canAskForForm(client.value.clientCapabilities);
    const outcome = yield* Effect.result(
      Option.isNone(client) || !formElicitation
        ? Effect.fail(
            new ApprovalDenied({
              capabilityName,
              reason: "The MCP client cannot ask a human for approval",
            }),
          )
        : askHuman(capabilityName, input, client.value),
    );
    // Log the decision only. Never the input or anything the user wrote.
    const annotations = {
      capability: capabilityName,
      clientName: Option.match(client, {
        onNone: () => "none",
        onSome: (value) => value.clientInfo.name,
      }),
      clientVersion: Option.match(client, {
        onNone: () => "none",
        onSome: (value) => value.clientInfo.version,
      }),
      formElicitation,
    };
    if (Result.isFailure(outcome)) {
      yield* Effect.logWarning("Approval denied").pipe(
        Effect.annotateLogs({ ...annotations, outcome: "denied", reason: outcome.failure.reason }),
      );
      return yield* outcome.failure;
    }
    yield* Effect.logInfo("Approval granted").pipe(
      Effect.annotateLogs({ ...annotations, outcome: "approved" }),
    );
  });

export const elicitationApproval: Layer.Layer<Approval> = Layer.succeed(Approval, {
  approve: approveByElicitation,
});
