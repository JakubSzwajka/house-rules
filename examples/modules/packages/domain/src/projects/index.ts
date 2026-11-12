import { Project } from "./project.aggregate.ts";
import { ProjectDirectory } from "./project-directory.view.ts";
import { SlugClaim } from "./slug-claim.aggregate.ts";
import { SlugSettlement, SlugSettlementLive } from "./slug-settlement.policy.ts";

export { ChangeProjectSlug, ProjectSlugClaimed } from "./change-project-slug.command.ts";
export { ChangeProjectStatus, ProjectStatusChanged } from "./change-project-status.command.ts";
export { CreateProject, ProjectSlugReserved } from "./create-project.command.ts";
export { EditProject, ProjectEdited } from "./edit-project.command.ts";
export { OpenProject, ProjectCreated, ProjectExists } from "./open-project.command.ts";
export { ProjectsPermissions } from "./permissions.ts";
export { Project, ProjectState } from "./project.aggregate.ts";
export { ProjectId, ProjectName, ProjectSlug } from "./project.id.ts";
export { DirectoryKey, ProjectDirectory } from "./project-directory.view.ts";
export { ProjectNotFound } from "./project-not-found.rejection.ts";
export { defaultStatuses, ProjectSettings, ProjectStatuses } from "./project-settings.context.ts";
export { ProjectsConfig, projectsConfig } from "./projects-config.middleware.ts";
export { ReleaseSlug, ProjectSlugReleased } from "./release-slug.command.ts";
export { SlugClaim } from "./slug-claim.aggregate.ts";
export { SlugSettlement, SlugSettlementLive, slugSettler } from "./slug-settlement.policy.ts";
export { SlugTaken } from "./slug-taken.rejection.ts";
export { ProjectSlugChanged, SwitchProjectSlug } from "./switch-project-slug.command.ts";
export { UnknownStatus } from "./unknown-status.rejection.ts";

export const aggregates = [SlugClaim, Project] as const;
export const views = [ProjectDirectory] as const;
export const policies = [SlugSettlement] as const;
export const handlers = SlugSettlementLive;
