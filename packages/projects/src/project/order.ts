import type { Project } from "./project.js";
const compare = (a: string, b: string) => (a < b ? -1 : a === b ? 0 : 1);
export const projectOrder = (a: Project, b: Project): number =>
  compare(a.name.toLowerCase(), b.name.toLowerCase()) || compare(a.slug, b.slug);
