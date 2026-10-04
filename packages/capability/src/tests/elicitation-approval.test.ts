import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { McpSchema } from "effect/unstable/ai";
import {
  ApprovalDenied,
  ApprovalForm,
  approvalMessage,
  elicitationApproval,
  implement,
} from "../index.ts";
import {
  accept,
  captureLogs,
  decline,
  type ElicitRequest,
  formClient,
  input,
  type LogLine,
  runShare,
  shareContract,
} from "./elicitation-fixtures.ts";

it.effect("an accept with no content approves and runs the handler", () =>
  Effect.gen(function* acceptNoContent() {
    const requests: Array<ElicitRequest> = [];
    const ran: Array<string> = [];
    const result = yield* runShare({ answer: accept(), capabilities: formClient }, requests, ran);

    expect(result).toBe("Shared t-7");
    expect(ran).toEqual(["t-7"]);
    expect(requests).toHaveLength(1);
  }),
);

it.effect("an accept with an empty content object approves", () =>
  Effect.gen(function* acceptEmpty() {
    const ran: Array<string> = [];
    const result = yield* runShare({ answer: accept({}), capabilities: formClient }, [], ran);

    expect(result).toBe("Shared t-7");
    expect(ran).toEqual(["t-7"]);
  }),
);

it.effect("the form has no fields and carries the input as JSON data", () =>
  Effect.gen(function* formShape() {
    const requests: Array<ElicitRequest> = [];
    yield* runShare({ answer: accept(), capabilities: formClient }, requests, []);
    const [request] = requests;

    expect(request?.message).toBe(approvalMessage("share_trip", input));
    expect(request?.message).toContain('"share_trip"');
    expect(request?.message).toContain(JSON.stringify(input, null, 2));
    const schema = request?.mode === "form" ? request.requestedSchema : undefined;
    expect(schema).toMatchObject({ type: "object", properties: {} });
    expect(schema?.required ?? []).toEqual([]);
    expect(ApprovalForm).toEqual({ type: "object", properties: {} });
  }),
);

it.effect("a declined form fails with ApprovalDenied", () =>
  Effect.gen(function* declined() {
    const ran: Array<string> = [];
    const error = yield* Effect.flip(
      runShare({ answer: decline("decline"), capabilities: formClient }, [], ran),
    );

    expect(error).toEqual(
      new ApprovalDenied({ capabilityName: "share_trip", reason: "Approval was declined" }),
    );
    expect(ran).toEqual([]);
  }),
);

it.effect("a cancelled form fails with ApprovalDenied", () =>
  Effect.gen(function* cancelled() {
    const ran: Array<string> = [];
    const error = yield* Effect.flip(
      runShare({ answer: decline("cancel"), capabilities: formClient }, [], ran),
    );

    expect(error).toEqual(
      new ApprovalDenied({ capabilityName: "share_trip", reason: "Approval was cancelled" }),
    );
    expect(ran).toEqual([]);
  }),
);

it.effect("a client without elicitation is refused without being asked", () =>
  Effect.gen(function* unsupportedClient() {
    const requests: Array<ElicitRequest> = [];
    const ran: Array<string> = [];
    const error = yield* Effect.flip(
      runShare(
        { answer: accept(), capabilities: new McpSchema.ClientCapabilities({}) },
        requests,
        ran,
      ),
    );

    expect(error.reason).toBe("The MCP client cannot ask a human for approval");
    expect(requests).toEqual([]);
    expect(ran).toEqual([]);
  }),
);

it.effect("a client that offers only URL elicitation is refused", () =>
  Effect.gen(function* urlOnlyClient() {
    const requests: Array<ElicitRequest> = [];
    const error = yield* Effect.flip(
      runShare(
        {
          answer: accept(),
          capabilities: new McpSchema.ClientCapabilities({ elicitation: { url: {} } }),
        },
        requests,
        [],
      ),
    );

    expect(error._tag).toBe("ApprovalDenied");
    expect(requests).toEqual([]);
  }),
);

it.effect("an empty elicitation capability counts as form support", () =>
  Effect.gen(function* emptyElicitation() {
    const capabilities = new McpSchema.ClientCapabilities({ elicitation: {} });
    const result = yield* runShare({ answer: accept(), capabilities }, [], []);

    expect(result).toBe("Shared t-7");
  }),
);

it.effect("a call outside an MCP request is refused", () =>
  Effect.gen(function* noClient() {
    const ran: Array<string> = [];
    const error = yield* Effect.flip(
      implement(shareContract, () =>
        Effect.sync(() => {
          ran.push("handler");
          return "shared";
        }),
      )
        .handler(input)
        .pipe(Effect.provide(elicitationApproval)),
    );

    expect(error.reason).toBe("The MCP client cannot ask a human for approval");
    expect(ran).toEqual([]);
  }),
);

it.effect("logs one info line for an approval, with the client and no input", () =>
  Effect.gen(function* logsApproved() {
    const lines: Array<LogLine> = [];
    yield* runShare({ answer: accept(), capabilities: formClient }, [], []).pipe(
      Effect.provide(captureLogs(lines)),
    );

    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      level: "Info",
      annotations: {
        capability: "share_trip",
        outcome: "approved",
        clientName: "test-client",
        clientVersion: "1.0.0",
        formElicitation: true,
      },
    });
    expect(JSON.stringify(lines)).not.toMatch(/Ignore previous|t-7/u);
  }),
);

it.effect("logs one warning line for a denial, with the reason and no input", () =>
  Effect.gen(function* logsDenied() {
    const lines: Array<LogLine> = [];
    yield* Effect.flip(
      runShare({ answer: decline("cancel"), capabilities: formClient }, [], []).pipe(
        Effect.provide(captureLogs(lines)),
      ),
    );

    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      level: "Warn",
      annotations: {
        capability: "share_trip",
        outcome: "denied",
        reason: "Approval was cancelled",
        clientName: "test-client",
      },
    });
    expect(JSON.stringify(lines)).not.toMatch(/Ignore previous|t-7/u);
  }),
);
