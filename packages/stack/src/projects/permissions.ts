import { system } from "../actor/actor.ts";

export const ProjectsPermissions = {
  read: "projects:read",
  write: "projects:write",
  settle: "projects:settle-slug",
} as const;

export const slugSettler = system("projects", [ProjectsPermissions.settle]);
