import type { AppMapSnapshot, MapModule } from "./app-map-snapshot.ts";

export const moduleGroups = (data: AppMapSnapshot) => [
  {
    title: "Modules",
    modules: data.modules.filter(
      (module) => module.kind === "package" && (module.role ?? "capability") === "capability",
    ),
  },
  {
    title: "Process modules",
    modules: data.modules.filter((module) => module.role === "process"),
  },
  {
    title: "Projections",
    modules: data.modules.filter(
      (module) =>
        (module.kind === "read-model" || module.kind === "projection") &&
        (module.role ?? "capability") === "capability",
    ),
  },
];

export const moduleOwner = (module: MapModule): "framework" | "app-owned" =>
  module.package?.startsWith("@house-rules/") === true ? "framework" : "app-owned";
