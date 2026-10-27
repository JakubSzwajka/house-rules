export const SUPPORT_MODULES = [
  "work-items",
  "notes",
  "relations",
  "event-log",
  "contacts",
  "notifications",
  "push",
  "push-node",
  "email",
  "projects",
];

export function supportImportLines() {
  const imports = SUPPORT_MODULES.flatMap((name) => {
    const binding = name.replaceAll("-", "_");
    return [
      `import * as support_${binding} from "@house-rules/${name}";`,
      ...(name === "push-node"
        ? []
        : [`import * as support_${binding}_contract from "@house-rules/${name}/contract";`]),
    ];
  });
  const entries = SUPPORT_MODULES.map((name) => {
    const binding = name.replaceAll("-", "_");
    return `{ name: "${name}", main: support_${binding}, contract: ${name === "push-node" ? "null" : `support_${binding}_contract`} }`;
  });
  return `${imports.join("\n")}\nconst supportPackages = [${entries.join(", ")}];`;
}
