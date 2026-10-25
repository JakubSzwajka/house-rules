import { Schema } from "effect";

const Name = Schema.String;
const Names = Schema.Array(Name);
const Edge = Schema.Struct({
  target: Name,
  kind: Schema.Literals(["operation", "feature"]),
  reason: Schema.optionalKey(Schema.String),
});

export const AppMapJson = Schema.Struct({
  layers: Schema.String,
  modules: Schema.Array(
    Schema.Struct({
      name: Name,
      service: Name,
      kind: Schema.Literals(["package", "read-model"]),
      role: Schema.optionalKey(Schema.Literals(["capability", "process"])),
      package: Schema.optionalKey(Schema.String),
      path: Schema.optionalKey(Schema.String),
      operations: Schema.Array(
        Schema.Struct({
          name: Name,
          permission: Schema.NullOr(Schema.String),
          readOnly: Schema.Boolean,
          destructive: Schema.Boolean,
          transactional: Schema.Boolean,
          needsApproval: Schema.Boolean,
          edges: Schema.Array(Edge),
        }),
      ),
    }),
  ),
  features: Schema.Array(
    Schema.Struct({
      name: Name,
      path: Schema.optionalKey(Schema.String),
      start: Schema.Union([
        Schema.Literal("person"),
        Schema.Struct({ kind: Schema.Literal("system"), reason: Name, startedBy: Name }),
      ]),
      permission: Schema.NullOr(Schema.String),
      flags: Schema.Struct({
        readOnly: Schema.Boolean,
        destructive: Schema.Boolean,
        transactional: Schema.Boolean,
        needsApproval: Schema.Boolean,
      }),
      closures: Schema.Struct({ person: Names, system: Names }),
      edges: Schema.Array(Edge),
      ways: Names,
    }),
  ),
  ways: Schema.Array(
    Schema.Struct({
      name: Name,
      protocol: Schema.Literals(["http", "mcp", "hook", "schedule", "event"]),
      path: Schema.optionalKey(Schema.String),
      source: Schema.optionalKey(Schema.String),
      mean: Schema.optionalKey(Schema.String),
      slot: Schema.optionalKey(Schema.String),
      on: Schema.optionalKey(Schema.Array(Schema.String)),
      clock: Schema.optionalKey(Schema.Struct({ cron: Schema.String, timeZone: Schema.String })),
      features: Names,
      public: Names,
    }),
  ),
  permissions: Schema.Array(Schema.Struct({ name: Name, operations: Names })),
  plugs: Schema.optionalKey(
    Schema.Array(
      Schema.Struct({
        name: Name,
        package: Schema.optionalKey(Schema.String),
        fills: Name,
        ways: Schema.optionalKey(Names),
      }),
    ),
  ),
});
