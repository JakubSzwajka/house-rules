import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const SITE_URL = "https://stack.kubaszwajka.com";
export const SITE_TITLE = "House Rules";
export const SITE_SUMMARY =
  "A TypeScript monorepo template and the house plugin behind it: checked rules for code that agents write.";
export const GITHUB_REPO = "https://github.com/JakubSzwajka/house-rules";
export const GITHUB_BRANCH = "main";

const readSourceRef = (value: string | undefined): string => {
  const ref = value?.trim() ?? "";
  if (ref === "") {
    return GITHUB_BRANCH;
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(ref) || ref.includes("..")) {
    throw new Error(`SITE_SOURCE_REF is not a plain branch, tag or commit name: ${ref}`);
  }
  return ref;
};

export const SOURCE_REF = readSourceRef(process.env["SITE_SOURCE_REF"]);

export const atSourceRef = (text: string, ref: string = SOURCE_REF): string =>
  text.replace(
    new RegExp(`(${GITHUB_REPO.replaceAll(".", "\\.")}/(?:blob|tree)/)${GITHUB_BRANCH}(?=/)`, "g"),
    (_match, prefix: string) => `${prefix}${ref}`,
  );

export const siteRoot = dirname(dirname(fileURLToPath(import.meta.url)));
export const repoRoot = dirname(siteRoot);
export const contentRoot = join(siteRoot, "src", "content", "docs");

export const SECTIONS = [
  {
    directory: "start",
    label: "Start",
    generated: false,
    summary:
      "what House Rules is, how to make a repo from the template, and what happens on commit.",
  },
  {
    directory: "rules",
    label: "Rules",
    generated: true,
    summary: "every checked rule, one row each. `/rules/#<rule-id>` points at one rule.",
  },
] as const;

export const githubUrl = (repoPath: string, kind: "blob" | "tree" = "blob"): string =>
  `${GITHUB_REPO}/${kind}/${GITHUB_BRANCH}/${repoPath}`;
