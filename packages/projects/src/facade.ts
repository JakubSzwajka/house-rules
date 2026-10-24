import { defineModule } from "@house-rules/domain";
import { Effect, Layer, Option, Schema } from "effect";
import { memoryProjectStore } from "./adapters/memory/project.js";
import { postgresProjectStore } from "./adapters/postgres/project.js";
import { ProjectStore } from "./storage.js";
import { ProjectAccess } from "./project/access.js";
import { ProjectsOptions, projectsPresets } from "./project/options.js";
import { ProjectInputInvalid } from "./project/project.js";
import { makeProjects } from "./project/projects.js";
export class Projects extends defineModule<Projects, ReturnType<typeof makeProjects>>()(
  "projects",
  {
    make: (options: ProjectsOptions = projectsPresets.default) =>
      Effect.gen(function* () {
        const invalid = () =>
          new ProjectInputInvalid({ field: "options", message: "Invalid projects options." });
        const settings = yield* Schema.decodeEffect(ProjectsOptions)(options).pipe(
          Effect.mapError(invalid),
        );
        if (
          new Set(settings.statuses).size !== settings.statuses.length ||
          !settings.statuses.includes(settings.defaultStatus) ||
          !settings.statuses.includes(settings.archivedStatus)
        )
          return yield* invalid();
        const pattern = yield* Effect.try({
          try: () => new RegExp(settings.slug.pattern),
          catch: invalid,
        });
        return makeProjects(
          yield* ProjectStore,
          Option.getOrUndefined(yield* Effect.serviceOption(ProjectAccess)),
          settings,
          pattern,
        );
      }),
  },
) {
  static readonly presets = projectsPresets;
  static readonly layerMemory = (options: ProjectsOptions = projectsPresets.default) =>
    this.layer(options).pipe(Layer.provide(memoryProjectStore()));
  static readonly layerPostgres = (options: ProjectsOptions = projectsPresets.default) =>
    this.layer(options).pipe(Layer.provide(postgresProjectStore));
}
