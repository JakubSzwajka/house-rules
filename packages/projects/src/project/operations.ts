import { defineOperation } from "@house-rules/domain/contract";
import { Schema } from "effect";
import { CreateProjectResult, UpdateProjectResult } from "./events.js";
import {
  NewProject,
  Project,
  ProjectFailure,
  ProjectFilter,
  ProjectPatch,
  ProjectRef,
} from "./project.js";
import { ProjectPermissions } from "./permissions.js";
const create = defineOperation("Projects.create", {
  description: "Create a project with a unique slug.",
  input: NewProject,
  output: CreateProjectResult,
  failure: ProjectFailure,
  permission: ProjectPermissions.write,
  edges: [],
  transactional: true,
});
const update = defineOperation("Projects.update", {
  description: "Change a project's fields, including its slug.",
  input: Schema.Struct({ ref: ProjectRef, patch: ProjectPatch }),
  output: UpdateProjectResult,
  failure: ProjectFailure,
  permission: ProjectPermissions.write,
  edges: [],
  transactional: true,
});
const show = defineOperation("Projects.show", {
  description: "Read a project by id or slug.",
  input: ProjectRef,
  output: Project,
  failure: ProjectFailure,
  permission: ProjectPermissions.read,
  edges: [],
  readOnly: true,
});
const list = defineOperation("Projects.list", {
  description: "List projects by case-insensitive name then slug, optionally filtering status.",
  input: ProjectFilter,
  output: Schema.Array(Project),
  failure: ProjectFailure,
  permission: ProjectPermissions.read,
  edges: [],
  readOnly: true,
});
const archive = defineOperation("Projects.archive", {
  description: "Set a project to the configured archived status.",
  input: ProjectRef,
  output: UpdateProjectResult,
  failure: ProjectFailure,
  permission: ProjectPermissions.write,
  edges: [],
  transactional: true,
});
export const ProjectsOperations = { create, update, show, list, archive } as const;
