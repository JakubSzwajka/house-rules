import * as Schema from "effect/Schema";

export const WorkItemId = Schema.String.pipe(Schema.brand("WorkItemId"));
export type WorkItemId = typeof WorkItemId.Type;

export const WorkItemTitle = Schema.String.check(
  Schema.isTrimmed(),
  Schema.isMinLength(1),
  Schema.isMaxLength(200),
);

export const WorkItemBody = Schema.String.check(Schema.isMaxLength(20_000));
