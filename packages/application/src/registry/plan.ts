import { errorKind } from "@house-rules/domain/contract";
import { Schema, SchemaGetter, SchemaParser } from "effect";

const Name = Schema.NonEmptyString;
const Permission = Schema.NullOr(Schema.TemplateLiteral([Schema.String, ":", Schema.String]));
const Flag = Schema.optionalKey(Schema.Boolean);
export const PlanEdge = Schema.Union([
  Name,
  Schema.Struct({ target: Name, reason: Schema.String }),
]);
const Edges = Schema.optionalKey(Schema.Array(PlanEdge));
const Source = Schema.optionalKey(Schema.String);
export const PlanOperation = Schema.Struct({
  name: Name,
  permission: Permission,
  readOnly: Flag,
  destructive: Flag,
  transactional: Flag,
  needsApproval: Flag,
  edges: Edges,
});
const PlanModule = Schema.Struct({
  name: Name,
  service: Name,
  kind: Schema.Literals(["package", "read-model"]),
  role: Schema.optionalKey(Schema.Literals(["capability", "process"])),
  package: Schema.optionalKey(Schema.String),
  path: Source,
  operations: Schema.Array(PlanOperation),
});
export const PlanFeature = Schema.Struct({
  name: Name,
  path: Source,
  permission: Permission,
  readOnly: Flag,
  destructive: Flag,
  transactional: Flag,
  needsApproval: Flag,
  start: Schema.optionalKey(
    Schema.Union([
      Schema.Literal("person"),
      Schema.Struct({ reason: Schema.String, startedBy: Schema.String }),
    ]),
  ),
  edges: Edges,
});
const wayFields = {
  name: Name,
  source: Source,
  mean: Schema.optionalKey(Schema.Literals(["allow", "no", "elicitation"])),
  features: Schema.Array(Name),
} as const;
const PlanWay = Schema.Union([
  Schema.Struct({
    ...wayFields,
    protocol: Schema.Literals(["http", "mcp"]),
    path: Schema.String,
    public: Schema.optionalKey(Schema.Array(Name)),
  }),
  Schema.Struct({ ...wayFields, protocol: Schema.Literal("hook"), slot: Name }),
  Schema.Struct({
    ...wayFields,
    protocol: Schema.Literal("schedule"),
    clock: Schema.Struct({ cron: Schema.String, timeZone: Schema.String }),
  }),
]);

const PlanPlug = Schema.Struct({
  name: Name,
  package: Schema.optionalKey(Schema.String),
  fills: Name,
  ways: Schema.optionalKey(Schema.Array(Name)),
});

const PlanShape = Schema.Struct({
  modules: Schema.Array(PlanModule),
  features: Schema.Array(PlanFeature),
  ways: Schema.Array(PlanWay),
  plugs: Schema.optionalKey(Schema.Array(PlanPlug)),
});

export const Plan = Schema.Unknown.pipe(
  Schema.decodeTo(PlanShape, {
    decode: SchemaGetter.transformEffect((input, options) =>
      SchemaParser.decodeUnknownEffect(PlanShape)(input, {
        ...options,
        onExcessProperty: "error",
      }),
    ),
    encode: SchemaGetter.passthrough(),
  }),
);
export type Plan = typeof Plan.Type;

const PlanIssue = Schema.Struct({ path: Schema.String, reason: Schema.String });
export type PlanIssue = typeof PlanIssue.Type;

export class PlanInvalid extends Schema.TaggedError<PlanInvalid>()("PlanInvalid", {
  kind: errorKind("invalid"),
  reason: Schema.String,
  issues: Schema.Array(PlanIssue),
}) {
  override get message(): string {
    return this.reason;
  }
}
