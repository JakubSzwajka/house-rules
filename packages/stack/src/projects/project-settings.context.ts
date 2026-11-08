import * as Domain from "@alchemy.run/domain";
import * as Schema from "effect/Schema";

export const ProjectStatuses = Schema.Struct({
  statuses: Schema.Array(Schema.NonEmptyString),
  defaultStatus: Schema.NonEmptyString,
}).check(
  Schema.makeFilter(
    ({ statuses, defaultStatus }) =>
      new Set(statuses).size === statuses.length && statuses.includes(defaultStatus),
  ),
);
export type ProjectStatuses = typeof ProjectStatuses.Type;

export const defaultStatuses: ProjectStatuses = {
  statuses: ["active", "archived"],
  defaultStatus: "active",
};

export class ProjectSettings extends Domain.RequestContext<ProjectSettings>()(
  "HouseRules/Projects/ProjectSettings",
  ProjectStatuses,
) {}
