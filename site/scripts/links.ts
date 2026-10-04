import { statSync } from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";
import { isRelativeTarget, splitTarget } from "./markdown-text.ts";
import { contentRoot, githubUrl, repoRoot, SITE_URL } from "./site-map.ts";

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

export const rawPath = (contentPath: string): string => `${routeOf(contentPath) || "index"}.md`;

export const rawUrl = (contentPath: string): string => `${SITE_URL}/${rawPath(contentPath)}`;

const repoUrl = (repoPath: string): string => {
  const isDirectory = statSync(resolve(repoRoot, repoPath), {
    throwIfNoEntry: false,
  })?.isDirectory();
  return githubUrl(repoPath, isDirectory === true ? "tree" : "blob");
};

export type LinkStyle = "page" | "raw";

export const resolveLink = (
  fromFile: string,
  target: string,
  style: LinkStyle,
): string | undefined => {
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
    return `${style === "page" ? pageUrl(contentPath) : rawUrl(contentPath)}${hash}`;
  }
  const repoPath = inside(repoRoot, absolute);
  return repoPath === undefined ? undefined : `${repoUrl(repoPath)}${hash}`;
};
