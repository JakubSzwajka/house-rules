import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { GeneratedPage } from "./generated-page.ts";
import { generatedPage } from "./generated-page.ts";
import { resolveLink } from "./links.ts";
import {
  firstHeading,
  parseFrontmatter,
  rewriteLinks,
  withoutFirstHeading,
} from "./markdown-text.ts";
import { githubUrl, repoRoot } from "./site-map.ts";

export interface Skill {
  readonly name: string;
  readonly title: string;
  readonly description: string;
  readonly repoPath: string;
  readonly body: string;
}

export const readSkills = (): readonly Skill[] =>
  readdirSync(join(repoRoot, "skills"), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
    .map((folder) => {
      const repoPath = `skills/${folder}/SKILL.md`;
      const absolute = join(repoRoot, repoPath);
      const { fields, body } = parseFrontmatter(readFileSync(absolute, "utf8"));
      const name = fields["name"];
      const description = fields["description"];
      if (name !== folder || description === undefined) {
        throw new Error(`${repoPath}: frontmatter needs name: ${folder} and a description.`);
      }
      const linked = rewriteLinks(body, (target) => resolveLink(absolute, target, "page"));
      return {
        name,
        title: firstHeading(body) ?? name,
        description,
        repoPath,
        body: withoutFirstHeading(linked).trim(),
      };
    });

const skillPage = (skill: Skill, order: number): GeneratedPage =>
  generatedPage(`skills/${skill.name}.md`, {
    source: skill.repoPath,
    title: skill.title,
    description: skill.description,
    order,
    body: [
      `Skill \`${skill.name}\`, from [\`${skill.repoPath}\`](${githubUrl(skill.repoPath)}). An agent loads that file as a skill. This page shows the same text.`,
      skill.body,
      "[All skills](index.md)",
    ].join("\n\n"),
  });

const indexPage = (skills: readonly Skill[]): GeneratedPage =>
  generatedPage("skills/index.md", {
    source: "skills/*/SKILL.md",
    title: "Skills",
    description: `The ${skills.length} agent skills in house-rules, one page each.`,
    order: 0,
    label: "All skills",
    body: [
      "A skill is a Markdown file an agent loads when a job matches its description. Each skill lives in `skills/<name>/SKILL.md`, and each one has a page here with the same text. Point your agent harness at the `skills/` folder to load them.",
      [
        "| Skill | Use it to |",
        "| --- | --- |",
        ...skills.map(
          (skill) =>
            `| [${skill.name}](${skill.name}.md) | ${skill.description.replaceAll("|", "\\|")} |`,
        ),
      ].join("\n"),
    ].join("\n\n"),
  });

export const skillPages = (): readonly GeneratedPage[] => {
  const skills = readSkills();
  return [indexPage(skills), ...skills.map((skill, index) => skillPage(skill, index + 1))];
};
