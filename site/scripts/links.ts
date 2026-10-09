import { statSync } from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";
import { isRelativeTarget, splitTarget } from "./markdown-text.ts";
import { contentRoot, githubUrl, repoRoot } from "./site-map.ts";

const toPosix = (path: string): string => path.split(sep).join("/");

const inside = (root: string, path: string): string | undefined => {
  const rel = relative(root, path);
  return rel === "" || (!rel.startsWith("..") && !rel.startsWith(sep)) ? toPosix(rel) : undefined;
};

export const routeOf = (contentPath: string): string =>
  contentPath.replace(/\.md$/, "").replace(/(^|\/)index$/, "");

export const pageUrl = (contentPath: string): string => {
  const route = routeOf(contentPath);
  return route === "" ? "/" : `/${route}/`;
};

const repoUrl = (repoPath: string): string => {
  const isDirectory = statSync(resolve(repoRoot, repoPath), {
    throwIfNoEntry: false,
  })?.isDirectory();
  return githubUrl(repoPath, isDirectory === true ? "tree" : "blob");
};

export const resolveLink = (fromFile: string, target: string): string | undefined => {
  if (!isRelativeTarget(target)) {
    return undefined;
  }
  const { path, hash } = splitTarget(target);
  if (path === "") {
    return undefined;
  }
  const absolute = resolve(dirname(fromFile), decodeURIComponent(path));
  const contentPath = inside(contentRoot, absolute);
  if (contentPath?.endsWith(".md") === true) {
    return `${pageUrl(contentPath)}${hash}`;
  }
  const repoPath = inside(repoRoot, absolute);
  return repoPath === undefined ? undefined : `${repoUrl(repoPath)}${hash}`;
};
