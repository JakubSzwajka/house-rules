import { afterAll, expect, it } from "@effect/vitest";
import { defineNode, NoInput, NoOpenUnit, UnitOfWorkFailed } from "@house-rules/domain";
import { Effect, Schema } from "effect";
import {
  ApprovalDenied,
  call,
  CompositionClosed,
  defineEntry,
  endpoint,
  Forbidden,
  GraphInvalid,
  NodeCallInvalid,
  type WordingOverrides,
} from "../index.ts";
import { answer, webRequest } from "./delivery-fixtures.ts";
import { callMcpTool, openMcpSession } from "./delivery-mcp-client.ts";
import { bindFixture } from "./entry-fixtures.ts";
import { bothFixture } from "./router-fixtures.ts";

const failures = Schema.Union([
  Forbidden,
  ApprovalDenied,
  NoOpenUnit,
  UnitOfWorkFailed,
  GraphInvalid,
  NodeCallInvalid,
  CompositionClosed,
]);
const errors = [
  new Forbidden({ entry: "probe", permission: "items:private", caller: "system" }),
  new ApprovalDenied({ entry: "probe", reason: "binding adapter-private refused" }),
  new NoOpenUnit(),
  new UnitOfWorkFailed({ reason: "binding adapter-private commit failed" }),
  new GraphInvalid({ reason: "binding adapter-private missing" }),
  new NodeCallInvalid({ node: "adapter-private", reason: "binding missing" }),
  new CompositionClosed(),
] as const;
const disposers: Array<() => Promise<void>> = [];
afterAll(() => Promise.all(disposers.map((dispose) => dispose())));

for (const error of errors) {
  it.effect(
    `${error._tag} keeps internal details but sends only a fixed HTTP and MCP message`,
    () =>
      Effect.gen(function* () {
        const entry = bindFixture(
          defineEntry(
            defineNode("probe", {
              description: "Fail with a kit diagnostic.",
              input: NoInput,
              output: Schema.Void,
              failure: failures,
              permission: null,
              readOnly: true,
            }),
          ),
          () => Effect.fail(error),
        );
        const fixture = bothFixture([entry], { endpoints: [endpoint(entry)] });
        disposers.push(fixture.dispose);
        const internalMessage = error.message;
        const outcome = yield* Effect.promise(() =>
          call(
            fixture.app,
            entry,
            {},
            {
              headers: new Headers(),
              url: "https://app.example/probe",
            },
            { way: "web" },
          ),
        );
        expect(outcome.ok ? undefined : outcome.error).toBe(error);
        expect(error.message).toBe(internalMessage);
        const message =
          error._tag === "Forbidden"
            ? "You may not use probe."
            : error._tag === "ApprovalDenied"
              ? "This action was not approved."
              : "Try again shortly.";
        const body = { error: { code: error.kind, message } };
        const http = yield* answer(
          fixture.handler,
          webRequest("https://app.example/probe", {
            method: "POST",
            body: "{}",
          }),
        );
        expect(http.status).toBe(error.kind === "forbidden" ? 403 : 503);
        expect(http.body).toEqual(body);
        const session = yield* openMcpSession(fixture.handler, { authorization: "Bearer fixture" });
        const mcp = yield* callMcpTool(fixture.handler, session, "probe", {});
        expect(mcp.result?.["isError"]).toBe(true);
        const text = (mcp.result?.["content"] as Array<{ text: string }>)[0]?.text ?? "";
        expect(JSON.parse(text)).toEqual(body);
        for (const sent of [JSON.stringify(http.body), JSON.stringify(mcp.result)]) {
          expect(sent).not.toMatch(
            /items:private|binding|adapter-private|UnitOfWork\.atomic|shutting down/u,
          );
          expect(sent).not.toContain(error._tag);
        }
      }),
  );
}

it.effect(
  "message overrides run after kit sanitization and receive the original structured error",
  () =>
    Effect.gen(function* () {
      const seen: unknown[] = [];
      const wording = (error: typeof failures.Type) => {
        seen.push(error);
        return "Contact support.";
      };
      const overrides: WordingOverrides<typeof failures.Type> = {
        Forbidden: wording,
        ApprovalDenied: wording,
        NoOpenUnit: wording,
        UnitOfWorkFailed: wording,
        GraphInvalid: wording,
        NodeCallInvalid: wording,
        CompositionClosed: wording,
      };
      for (const error of errors) {
        const entry = bindFixture(
          defineEntry(
            defineNode("override_probe", {
              description: "Override a kit message.",
              input: NoInput,
              output: Schema.Void,
              failure: failures,
              permission: null,
              readOnly: true,
            }),
          ),
          () => Effect.fail(error),
        );
        const fixture = bothFixture([entry], { endpoints: [endpoint(entry)], overrides });
        disposers.push(fixture.dispose);
        const http = yield* answer(
          fixture.handler,
          webRequest("https://app.example/override_probe", {
            method: "POST",
            body: "{}",
          }),
        );
        expect(http.body).toEqual({ error: { code: error.kind, message: "Contact support." } });
        const session = yield* openMcpSession(fixture.handler, { authorization: "Bearer fixture" });
        const mcp = yield* callMcpTool(fixture.handler, session, "override_probe", {});
        expect(JSON.stringify(mcp.result)).toContain("Contact support.");
        expect(seen.slice(-2)).toEqual([error, error]);
      }
    }),
);
