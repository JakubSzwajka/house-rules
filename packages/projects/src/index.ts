import type { MountDefinition } from "@house-rules/application";
import { Projects } from "./facade.js";
import { ProjectsOperations } from "./contract.js";
import { bindProjects } from "./project/bind-projects.js";
export const ProjectsMount = {
  map: { name: "projects", kind: "package", role: "capability", package: "@house-rules/projects" },
  service: Projects,
  operations: Object.values(ProjectsOperations),
  bind: bindProjects,
} satisfies MountDefinition<Projects, Projects["Service"]>;
export { Projects } from "./facade.js";
export { bindProjects } from "./project/bind-projects.js";
export { ProjectAccess } from "./project/access.js";
export { ProjectsOptions } from "./project/options.js";
export { ProjectStore } from "./storage.js";
export { memoryProjectStore } from "./adapters/memory/project.js";
export { postgresProjectStore } from "./adapters/postgres/project.js";
export {
  CreateProjectResult,
  UpdateProjectResult,
  ProjectEvents,
  ProjectsOperations,
  ProjectPermissions,
  type ProjectPermission,
  Project,
  ProjectRef,
  NewProject,
  ProjectPatch,
  ProjectFilter,
  ProjectFailure,
  ProjectNotFound,
  ProjectSlugTaken,
  ProjectInputInvalid,
  ProjectAccessDenied,
  ProjectAccessUnavailable,
  ProjectStoreUnavailable,
} from "./contract.js";
