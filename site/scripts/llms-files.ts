import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { pageUrl, rawPath, rawUrl, resolveLink } from "./links.ts";
import { parseFrontmatter, rewriteLinks } from "./markdown-text.ts";
import {
  atSourceRef,
  contentRoot,
  SECTIONS,
  SITE_SUMMARY,
  SITE_TITLE,
  SITE_URL,
  SOURCE_REF,
} from "./site-map.ts";

export interface ContentPage {
  readonly contentPath: string;
  readonly title: string;
  readonly description: string;
  readonly order: number;
  readonly markdown: string;
}

const sectionIndex = (contentPath: string): number => {
  const top = contentPath.split("/")[0] ?? "";
  const index = SECTIONS.findIndex((section) => section.directory === top);
  return contentPath === "index.md" ? -1 : index === -1 ? SECTIONS.length : index;
};

const isIndex = (page: ContentPage): boolean => page.contentPath.endsWith("index.md");

const readingOrder = (pages: readonly ContentPage[]): readonly ContentPage[] => {
  const orderOf = new Map(pages.map((page) => [page.contentPath, page.order]));
  const key = (page: ContentPage): readonly [number, number, string, number, string] => {
    const folder = dirname(page.contentPath);
    const folderRank = folder.includes("/") ? (orderOf.get(`${folder}/index.md`) ?? 0) : -1;
    return [
      sectionIndex(page.contentPath),
      folderRank,
      folder,
      isIndex(page) ? -1 : page.order,
      page.contentPath,
    ];
  };
  return [...pages].sort((left, right) => {
    const [a, b] = [key(left), key(right)];
    return (
      a[0] - b[0] ||
      a[1] - b[1] ||
      a[2].localeCompare(b[2]) ||
      a[3] - b[3] ||
      a[4].localeCompare(b[4])
    );
  });
};

export const readContentPages = (): readonly ContentPage[] =>
  readingOrder(
    readdirSync(contentRoot, { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
      .map((entry) => {
        const absolute = join(entry.parentPath, entry.name);
        const contentPath = relative(contentRoot, absolute).split(sep).join("/");
        const text = readFileSync(absolute, "utf8");
        const { fields, body } = parseFrontmatter(text);
        const title = fields["title"];
        if (title === undefined) {
          throw new Error(`${contentPath}: frontmatter needs a title.`);
        }
        const linked = rewriteLinks(body, (target) => resolveLink(absolute, target, "raw"));
        const description = fields["description"] ?? "";
        return {
          contentPath,
          title,
          description,
          order: Number(/^ +order: *(\d+)/m.exec(text)?.[1] ?? Number.MAX_SAFE_INTEGER),
          markdown: [
            `# ${title}`,
            ...(description === "" ? [] : [`> ${description}`]),
            linked.trim(),
            `Page: ${SITE_URL}${pageUrl(contentPath)}`,
          ].join("\n\n"),
        };
      }),
  );

const indexEntry = (page: ContentPage): string =>
  `- [${page.title}](${rawUrl(page.contentPath)})${page.description === "" ? "" : `: ${page.description}`}`;

const llmsIndex = (pages: readonly ContentPage[], ref: string): string => {
  const sections = SECTIONS.map((section) => {
    const own = pages.filter((page) => page.contentPath.startsWith(`${section.directory}/`));
    return `## ${section.label}\n\n${own.map(indexEntry).join("\n")}`;
  });
  return [
    `# ${SITE_TITLE}`,
    `> ${SITE_SUMMARY}`,
    [
      `Every page below is a Markdown file. The same page as HTML lives at the path without \`.md\`. ${SITE_URL}/llms-full.txt holds every page in one file.`,
      `The law for code in House Rules is AGENTS.md in the repository. Generated rule and skill pages come from packages/rules and skills/, so they match the code at the \`${ref}\` ref, and every source link points at that ref.`,
    ].join(" "),
    ...sections,
  ].join("\n\n");
};

export const llmsFiles = (
  pages: readonly ContentPage[],
  ref: string = SOURCE_REF,
): ReadonlyMap<string, string> => {
  const retarget = (page: ContentPage): ContentPage => ({
    ...page,
    markdown: atSourceRef(page.markdown, ref),
  });
  const retargeted = pages.map(retarget);
  return new Map([
    ["llms.txt", `${llmsIndex(retargeted, ref)}\n`],
    ["llms-full.txt", `${retargeted.map((page) => page.markdown).join("\n\n---\n\n")}\n`],
    ...retargeted.map((page): [string, string] => [
      rawPath(page.contentPath),
      `${page.markdown}\n`,
    ]),
  ]);
};

export const writeLlmsFiles = (outDir: string): number => {
  const files = llmsFiles(readContentPages());
  for (const [path, text] of files) {
    const target = join(outDir, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, text);
  }
  return files.size;
};
