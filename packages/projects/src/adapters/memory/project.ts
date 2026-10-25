import { UnitOfWork } from "@house-rules/domain";
import { Effect, Layer } from "effect";
import { ProjectStore } from "../../storage.js";
import { type Project, ProjectSlugTaken, ProjectStoreUnavailable } from "../../project/project.js";
import { projectOrder } from "../../project/order.js";
export const memoryProjectStore = (): Layer.Layer<ProjectStore> =>
  Layer.sync(ProjectStore, () => {
    const rows = new Map<string, Project>();
    const save = Effect.fn("ProjectStore.memory.save")(function* (
      project: Project,
      insert: boolean,
    ) {
      yield* UnitOfWork.required;
      if ([...rows.values()].some((row) => row.slug === project.slug && row.id !== project.id)) {
        return yield* new ProjectSlugTaken({ slug: project.slug });
      }
      const before = rows.get(project.id);
      if (insert === (before !== undefined))
        return yield* new ProjectStoreUnavailable({ cause: "Invalid project id." });
      yield* UnitOfWork.onRollback(
        Effect.sync(() => {
          if (before === undefined) rows.delete(project.id);
          else rows.set(project.id, before);
        }),
      );
      rows.set(project.id, { ...project });
    });
    return ProjectStore.of({
      lock: UnitOfWork.required,
      get: (ref) =>
        Effect.sync(() => {
          const found =
            "id" in ref
              ? rows.get(ref.id)
              : [...rows.values()].find((row) => row.slug === ref.slug);
          return found === undefined ? undefined : { ...found };
        }),
      list: (status, ids) =>
        Effect.sync(() =>
          [...rows.values()]
            .filter(
              (row) =>
                (status === undefined || row.status === status) &&
                (ids === undefined || ids.includes(row.id)),
            )
            .sort(projectOrder)
            .map((row) => ({ ...row })),
        ),
      insert: (project) => save(project, true),
      replace: (project) => save(project, false),
    });
  });
