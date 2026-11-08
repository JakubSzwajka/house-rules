import * as Schema from "effect/Schema";

export const ProjectId = Schema.String.pipe(Schema.brand("ProjectId"));
export type ProjectId = typeof ProjectId.Type;

export const ProjectSlug = Schema.String.check(
  Schema.isPattern(/^[a-z0-9][a-z0-9-]*$/),
  Schema.isMaxLength(64),
).pipe(Schema.brand("ProjectSlug"));
export type ProjectSlug = typeof ProjectSlug.Type;

export const ProjectName = Schema.String.check(
  Schema.isTrimmed(),
  Schema.isMinLength(1),
  Schema.isMaxLength(200),
);
