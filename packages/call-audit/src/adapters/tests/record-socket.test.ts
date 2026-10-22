import { expect, expectTypeOf, layer } from "@effect/vitest";
import {
  type AnyFeature,
  Approval,
  bindOperation,
  CallWatch,
  defineFeature,
  May,
  Runtime,
  runFeature,
  StepTrace,
  type RecordSocket,
} from "@house-rules/application";
import { Context, Effect, Layer, Schema } from "effect";
import type { SqlClient } from "effect/sql/SqlClient";
import { AuditReadFailed, AuditStoreUnavailable, CallAudit, memoryAuditLog } from "../../index.ts";
import { migratedDatabase } from "./stores.ts";

const shape = {
  description: "Read through an inner node.",
  input: Schema.Struct({}),
  output: Schema.String,
  failure: Schema.Never,
  readOnly: true,
  destructive: false,
  transactional: false,
} as const;
const child = {
  ...shape,
  kind: "operation",
  name: "inner_read",
  permission: "audit:read",
  needsApproval: true,
  edges: [],
} as const;
const entry = defineFeature("outer_read", {
  ...shape,
  permission: null,
  flags: { readOnly: true },
  edges: [child],
  start: { kind: "system", reason: "audit test", startedBy: "test" },
  handler: (input, { call }) => call(child, input),
});
let ran = 0;
const runtime = Runtime.layer({
  features: [entry],
  ways: [],
  mounts: [
    {
      service: Context.Reference("test/record", { defaultValue: () => ({}) }),
      operations: [child],
      bind: () => [
        bindOperation(child, () =>
          Effect.sync(() => {
            ran++;
            return "ok";
          }),
        ),
      ],
    },
  ],
});
const execution = Layer.merge(runtime, StepTrace.layer());
const permissions = (allow: boolean) =>
  Layer.succeedContext(May.system([entry], { system: allow ? ["audit:read"] : [], via: "test" }));
const options = { who: Effect.succeed("before"), policy: CallAudit.presets.strict };
expectTypeOf<typeof AuditReadFailed>().toExtend<AnyFeature["failure"]>();
expectTypeOf<typeof AuditStoreUnavailable>().toExtend<AnyFeature["failure"]>();
expectTypeOf<AuditReadFailed>().toExtend<AnyFeature["failure"]["Type"]>();
expectTypeOf<AuditStoreUnavailable>().toExtend<AnyFeature["failure"]["Type"]>();
expectTypeOf<AuditReadFailed["kind"]>().toEqualTypeOf<"unavailable">();
expectTypeOf<AuditStoreUnavailable["kind"]>().toEqualTypeOf<"unavailable">();
const postgres = CallAudit.record.postgres(options);
expectTypeOf(postgres).toEqualTypeOf<RecordSocket<never, SqlClient>>();
expectTypeOf<Layer.Success<typeof postgres.layer>>().toEqualTypeOf<CallWatch>();
expectTypeOf<Layer.Services<typeof postgres.layer>>().toEqualTypeOf<SqlClient>();
expectTypeOf<
  Layer.Success<ReturnType<typeof CallAudit.record.memory>["layer"]>
>().toEqualTypeOf<CallWatch>();

layer(migratedDatabase("record_socket"), { excludeTestServices: true, timeout: "30 seconds" })(
  "Record sockets",
  (it) => {
    it.effect("audit failures supply unavailable kind and keep their existing fields", () =>
      Effect.sync(() => {
        // @ts-expect-error A failure schema cannot decode a plain string.
        expectTypeOf<typeof Schema.String>().toExtend<AnyFeature["failure"]>();
        const unkinded = Schema.TaggedStruct("Diagnostic", { message: Schema.String });
        // @ts-expect-error A tagged diagnostic still needs a kind.
        expectTypeOf<typeof unkinded>().toExtend<AnyFeature["failure"]>();
        const read = new AuditReadFailed({ message: "read failed", cause: "read cause" });
        const write = new AuditStoreUnavailable({ message: "write failed", cause: "write cause" });
        expect(read).toMatchObject({
          kind: "unavailable",
          message: "read failed",
          cause: "read cause",
        });
        expect(write).toMatchObject({
          kind: "unavailable",
          message: "write failed",
          cause: "write cause",
        });
      }),
    );
    it.effect(
      "Postgres records once per entry, including closure and approval refusals under strict policy",
      () =>
        Effect.gen(function* () {
          ran = 0;
          const invoke = (allow: boolean, approved: boolean) =>
            runFeature(entry, {}).pipe(
              Effect.provide(
                Layer.mergeAll(
                  execution,
                  permissions(allow),
                  approved ? Approval.allowAll : Approval.denyAll,
                ),
              ),
            );
          expect(yield* Effect.flip(invoke(false, true))).toMatchObject({
            _tag: "Forbidden",
            permission: "audit:read",
          });
          expect(yield* Effect.flip(invoke(true, false))).toMatchObject({ _tag: "ApprovalDenied" });
          expect(yield* invoke(true, true)).toBe("ok");
          expect(ran).toBe(1);
          const rows = yield* CallAudit.readRows();
          expect(rows).toHaveLength(3);
          expect(rows.map((row) => row.outcome)).toEqual([
            "success",
            "ApprovalDenied",
            "Forbidden",
          ]);
          for (const row of rows)
            expect(row).toMatchObject({
              capability: "outer_read",
              target: "outer_read",
              permission: "",
              targetId: null,
              viewerId: "before",
            });
        }).pipe(Effect.provide(postgres.layer)),
    );

    it.effect(
      "memory socket wraps the existing watch and keeps entry target separate from object target",
      () =>
        Effect.gen(function* () {
          const log = memoryAuditLog();
          const plug = CallAudit.record.memory(log);
          yield* CallWatch.use((watch) =>
            watch.around(entry, { id: "not-an-audit-target" }, Effect.succeed("ok"), {
              target: "forged",
              kind: "read",
              targetId: "object-id",
              channel: "test",
              requestId: null,
            }),
          ).pipe(Effect.provide(plug.layer));
          expect(log.entries()).toMatchObject([
            {
              capability: "outer_read",
              target: "outer_read",
              targetId: "object-id",
              permission: "",
              viewerId: null,
            },
          ]);
        }),
    );
  },
);
