import { expect, it } from "@effect/vitest";
import { Actor, ActorId, memoryUnitOfWork, UnitOfWork } from "@house-rules/domain";
import { Effect, Layer } from "effect";
import { ProjectAccessUnavailable, Projects, ProjectStoreUnavailable } from "../index.js";
const actor = Actor.make({ id: ActorId.make("owner") });
it.effect("supports configured statuses, archive, slug rules and normalisation", () =>
  Effect.gen(function* () {
    const projects = yield* Projects;
    const { project } = yield* UnitOfWork.atomic(
      projects.create(actor, { slug: "Board_Code", name: " Board " }),
    );
    expect(project).toMatchObject({ slug: "Board_Code", status: "open", name: "Board" });
    expect(
      (yield* UnitOfWork.atomic(projects.archive(actor, { id: project.id }))).project.status,
    ).toBe("closed");
    expect(
      yield* Effect.flip(
        UnitOfWork.atomic(projects.create(actor, { slug: "toolongslug", name: "Long" })),
      ),
    ).toMatchObject({ _tag: "ProjectInputInvalid" });
  }).pipe(
    Effect.provide(
      Layer.merge(
        Projects.layerMemory({
          statuses: ["open", "closed"],
          defaultStatus: "open",
          archivedStatus: "closed",
          slug: {
            pattern: "^[A-Za-z0-9][A-Za-z0-9_-]*$",
            maxLength: 10,
            lowercase: false,
            trim: false,
          },
        }),
        memoryUnitOfWork,
      ),
    ),
  ),
);
it.effect("rejects malformed configuration without defects", () =>
  Effect.gen(function* () {
    for (const options of [
      { ...Projects.presets.default, statuses: ["active", "active"] },
      { ...Projects.presets.default, defaultStatus: "unknown" },
      { ...Projects.presets.default, archivedStatus: "unknown" },
      { ...Projects.presets.default, statuses: [] },
      { ...Projects.presets.default, slug: { ...Projects.presets.default.slug, maxLength: 0 } },
      { ...Projects.presets.default, slug: { ...Projects.presets.default.slug, pattern: "[" } },
    ]) {
      const failed = yield* Effect.flip(Effect.scoped(Layer.build(Projects.layerMemory(options))));
      expect(failed).toMatchObject({ _tag: "ProjectInputInvalid", kind: "invalid" });
    }
  }),
);
it.effect("keeps unavailable messages fixed", () =>
  Effect.sync(() => {
    expect(new ProjectStoreUnavailable({ cause: "secret driver details" }).message).toBe(
      "Projects are unavailable. Try again shortly.",
    );
    expect(new ProjectAccessUnavailable({ cause: "secret port details" }).message).toBe(
      "Project access is unavailable. Try again shortly.",
    );
  }),
);
