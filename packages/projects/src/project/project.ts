import { errorKind } from "@house-rules/domain/contract";
import { Schema } from "effect";

export const Project = Schema.Struct({
  id: Schema.NonEmptyString,
  slug: Schema.NonEmptyString,
  name: Schema.NonEmptyString,
  status: Schema.NonEmptyString,
  description: Schema.String,
  createdAt: Schema.Int,
  updatedAt: Schema.Int,
});
export type Project = typeof Project.Type;
export const ProjectRef = Schema.Union([
  Schema.Struct({ id: Schema.NonEmptyString }),
  Schema.Struct({ slug: Schema.NonEmptyString }),
]);
export type ProjectRef = typeof ProjectRef.Type;
export const NewProject = Schema.Struct({
  slug: Schema.String,
  name: Schema.String,
  status: Schema.optionalKey(Schema.String),
  description: Schema.optionalKey(Schema.String),
});
export type NewProject = typeof NewProject.Type;
export const ProjectPatch = Schema.Struct({
  slug: Schema.optionalKey(Schema.String),
  name: Schema.optionalKey(Schema.String),
  status: Schema.optionalKey(Schema.String),
  description: Schema.optionalKey(Schema.String),
});
export type ProjectPatch = typeof ProjectPatch.Type;
export const ProjectFilter = Schema.Struct({ status: Schema.optionalKey(Schema.String) });
export type ProjectFilter = typeof ProjectFilter.Type;
export class ProjectNotFound extends Schema.TaggedError<ProjectNotFound>()("ProjectNotFound", {
  kind: errorKind("not_found"),
}) {}
export class ProjectSlugTaken extends Schema.TaggedError<ProjectSlugTaken>()("ProjectSlugTaken", {
  kind: errorKind("conflict"),
  slug: Schema.String,
}) {}
export class ProjectInputInvalid extends Schema.TaggedError<ProjectInputInvalid>()(
  "ProjectInputInvalid",
  {
    kind: errorKind("invalid"),
    field: Schema.Literals(["slug", "name", "status", "options"]),
    message: Schema.String,
  },
) {}
export class ProjectAccessDenied extends Schema.TaggedError<ProjectAccessDenied>()(
  "ProjectAccessDenied",
  {
    kind: errorKind("forbidden"),
  },
) {}
export class ProjectStoreUnavailable extends Schema.TaggedError<ProjectStoreUnavailable>()(
  "ProjectStoreUnavailable",
  {
    kind: errorKind("unavailable"),
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return "Projects are unavailable. Try again shortly.";
  }
}
export class ProjectAccessUnavailable extends Schema.TaggedError<ProjectAccessUnavailable>()(
  "ProjectAccessUnavailable",
  {
    kind: errorKind("unavailable"),
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return "Project access is unavailable. Try again shortly.";
  }
}
export const ProjectFailure = Schema.Union([
  ProjectNotFound,
  ProjectSlugTaken,
  ProjectInputInvalid,
  ProjectAccessDenied,
  ProjectStoreUnavailable,
  ProjectAccessUnavailable,
]);
export type ProjectFailure = typeof ProjectFailure.Type;
