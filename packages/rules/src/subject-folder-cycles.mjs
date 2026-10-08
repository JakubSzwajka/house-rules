import path from "node:path";
import { subjectFolderPatterns } from "./dependency-cruiser.cjs";

function packageRootFor(source, packagePattern) {
  const match = packagePattern.exec(source);
  return match?.[1];
}

function subjectFolderFor(source, packageRoot, packagePattern, adapterPattern, testPattern) {
  if (packageRootFor(source, packagePattern) !== packageRoot) return undefined;
  if (adapterPattern.test(source) || testPattern.test(source)) return undefined;

  const sourceRoot = `${packageRoot}/src/`;
  if (!source.startsWith(sourceRoot)) return undefined;
  const [subject, file] = source.slice(sourceRoot.length).split("/");
  if (!subject || file === undefined) return undefined;

  const folder = `${sourceRoot}${subject}`;
  if (adapterPattern.test(`${folder}/`) || testPattern.test(`${folder}/`)) return undefined;
  return folder;
}

function findCycles(graph) {
  const state = new Map();
  const active = [];
  const cycles = [];

  const visit = (folder) => {
    state.set(folder, 1);
    active.push(folder);

    for (const dependency of [...graph.get(folder)].sort()) {
      if (state.get(dependency) === 1) {
        const start = active.indexOf(dependency);
        cycles.push([...active.slice(start), dependency]);
      } else if (state.get(dependency) === undefined) {
        visit(dependency);
      }
    }

    active.pop();
    state.set(folder, 2);
  };

  for (const folder of [...graph.keys()].sort()) {
    if (state.get(folder) === undefined) visit(folder);
  }

  return cycles;
}

export function findSubjectFolderCycles(modules, config, baseDir = process.cwd()) {
  const patterns = subjectFolderPatterns(config);
  const packagePattern = new RegExp(patterns.package);
  const adapterPattern = new RegExp(patterns.adapter);
  const testPattern = new RegExp(patterns.test);

  const normalize = (source) => {
    if (typeof source !== "string") return source;
    const relative = path.isAbsolute(source) ? path.relative(baseDir, source) : source;
    return relative.split(path.sep).join("/").replace(/^\.\//u, "");
  };

  const files = modules.map((module) => ({
    ...module,
    source: normalize(module.source),
    dependencies: module.dependencies.map((dependency) => ({
      ...dependency,
      resolved: normalize(dependency.resolved),
    })),
  }));
  const graphByPackage = new Map();
  const sourceFolders = new Map();
  const edgeExamples = new Map();

  for (const module of files) {
    const packageRoot = packageRootFor(module.source, packagePattern);
    if (packageRoot === undefined) continue;
    const folder = subjectFolderFor(
      module.source,
      packageRoot,
      packagePattern,
      adapterPattern,
      testPattern,
    );
    if (folder === undefined) continue;

    const graph = graphByPackage.get(packageRoot) ?? new Map();
    graph.set(folder, graph.get(folder) ?? new Set());
    graphByPackage.set(packageRoot, graph);
    sourceFolders.set(module.source, { packageRoot, folder });
  }

  for (const module of files) {
    const source = sourceFolders.get(module.source);
    if (source === undefined) continue;

    for (const dependency of module.dependencies) {
      const targetFolder = subjectFolderFor(
        dependency.resolved,
        source.packageRoot,
        packagePattern,
        adapterPattern,
        testPattern,
      );
      if (targetFolder === undefined || targetFolder === source.folder) continue;
      graphByPackage.get(source.packageRoot).get(source.folder).add(targetFolder);
      const edgeKey = `${source.packageRoot}:${source.folder}->${targetFolder}`;
      if (!edgeExamples.has(edgeKey)) {
        edgeExamples.set(edgeKey, { from: module.source, to: dependency.resolved });
      }
    }
  }

  return [...graphByPackage].flatMap(([packageRoot, graph]) =>
    findCycles(graph).map((cycle) => ({
      packageRoot,
      cycle,
      examples: cycle.slice(0, -1).map((folder, index) => ({
        fromFolder: folder,
        toFolder: cycle[index + 1],
        ...edgeExamples.get(`${packageRoot}:${folder}->${cycle[index + 1]}`),
      })),
    })),
  );
}
