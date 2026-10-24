import { Schema } from "effect";
export const ProjectsOptions = Schema.Struct({
  statuses: Schema.Array(Schema.NonEmptyString).check(Schema.isMinLength(1)),
  defaultStatus: Schema.NonEmptyString,
  archivedStatus: Schema.NonEmptyString,
  slug: Schema.Struct({
    pattern: Schema.String,
    maxLength: Schema.Int.check(Schema.isGreaterThan(0)),
    lowercase: Schema.Boolean,
    trim: Schema.Boolean,
  }),
});
export type ProjectsOptions = typeof ProjectsOptions.Type;
export const projectsPresets = {
  default: {
    statuses: ["active", "archived"],
    defaultStatus: "active",
    archivedStatus: "archived",
    slug: { pattern: "^[a-z0-9][a-z0-9-]*$", maxLength: 64, lowercase: true, trim: true },
  },
} as const;
