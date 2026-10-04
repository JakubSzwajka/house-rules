import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import type { GeneratedPage } from "./generated-page.ts";
import { rulePages } from "./rule-pages.ts";
import { contentRoot, SECTIONS } from "./site-map.ts";
import { skillPages } from "./skill-pages.ts";

export const GENERATED_DIRECTORIES: readonly string[] = SECTIONS.filter(
  (section) => section.generated,
).map((section) => section.directory);

export const generatedPages = (): readonly GeneratedPage[] => [...rulePages(), ...skillPages()];

const filesUnder = (directory: string): string[] =>
  readdirSync(join(contentRoot, directory), { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => relative(contentRoot, join(entry.parentPath, entry.name)).split(sep).join("/"));

export const writeGeneratedPages = (pages: readonly GeneratedPage[]): void => {
  for (const directory of GENERATED_DIRECTORIES) {
    rmSync(join(contentRoot, directory), { recursive: true, force: true });
  }
  for (const page of pages) {
    const target = join(contentRoot, page.path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, page.text);
  }
};

export const staleGeneratedPages = (pages: readonly GeneratedPage[]): readonly string[] => {
  const expected = new Map(pages.map((page) => [page.path, page.text]));
  const onDisk = GENERATED_DIRECTORIES.flatMap((directory) => {
    try {
      return filesUnder(directory);
    } catch {
      return [];
    }
  });
  const extra = onDisk
    .filter((path) => !expected.has(path))
    .map((path) => `${path}: not generated`);
  const changed = [...expected].flatMap(([path, text]) => {
    try {
      return readFileSync(join(contentRoot, path), "utf8") === text ? [] : [`${path}: out of date`];
    } catch {
      return [`${path}: missing`];
    }
  });
  return [...changed, ...extra];
};
