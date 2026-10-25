import { Schema } from "effect";
const cap = Schema.Int.check(Schema.isGreaterThan(0));
export const RelationType = Schema.Struct({
  name: Schema.NonEmptyString,
  source: Schema.Array(Schema.NonEmptyString).check(Schema.isMinLength(1)),
  target: Schema.Array(Schema.NonEmptyString).check(Schema.isMinLength(1)),
  directed: Schema.Boolean,
  acyclic: Schema.Boolean,
  unique: Schema.Boolean,
  maxOutPerSource: Schema.optionalKey(cap),
  maxInPerTarget: Schema.optionalKey(cap),
  maxDegree: Schema.optionalKey(cap),
});
export type RelationType = typeof RelationType.Type;
export const RelationsOptions = Schema.Struct({
  nodeKinds: Schema.Array(Schema.NonEmptyString).check(Schema.isMinLength(1)),
  relationTypes: Schema.Array(RelationType),
  maxGraphSize: cap,
  maxPageSize: cap,
}).check(
  Schema.makeFilter(
    (options) =>
      new Set(options.nodeKinds).size === options.nodeKinds.length &&
      new Set(options.relationTypes.map((type) => type.name)).size ===
        options.relationTypes.length &&
      options.relationTypes.every(
        (type) =>
          [...type.source, ...type.target].every((kind) => options.nodeKinds.includes(kind)) &&
          (type.directed
            ? type.maxDegree === undefined
            : !type.acyclic &&
              type.maxOutPerSource === undefined &&
              type.maxInPerTarget === undefined),
      ),
  ),
);
export type RelationsOptions = typeof RelationsOptions.Type;
