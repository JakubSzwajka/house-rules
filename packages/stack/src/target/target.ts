import * as Schema from "effect/Schema";

export const Target = Schema.Struct({
  kind: Schema.String.check(Schema.isPattern(/^[a-z][a-z0-9-]*$/)),
  id: Schema.NonEmptyString,
});
export type Target = typeof Target.Type;

export const TargetKey = Schema.String.pipe(Schema.brand("TargetKey"));
export type TargetKey = typeof TargetKey.Type;

export const targetKey = (target: Target): TargetKey =>
  TargetKey.make(`${target.kind}/${target.id}`);
