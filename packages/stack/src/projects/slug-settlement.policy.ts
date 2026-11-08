import * as Domain from "@alchemy.run/domain";
import * as Effect from "effect/Effect";
import { system } from "../actor/actor.ts";
import { CurrentActor } from "../actor/current-actor.context.ts";
import { ProjectSlugClaimed } from "./change-project-slug.command.ts";
import { ProjectSlugReserved } from "./create-project.command.ts";
import { OpenProject } from "./open-project.command.ts";
import { ProjectsPermissions } from "./permissions.ts";
import { Project } from "./project.aggregate.ts";
import { ReleaseSlug } from "./release-slug.command.ts";
import { SlugClaim } from "./slug-claim.aggregate.ts";
import { ProjectSlugChanged, SwitchProjectSlug } from "./switch-project-slug.command.ts";

export const slugSettler = system("SlugSettlement", [ProjectsPermissions.settle]);

export class SlugSettlement extends Domain.Policy("SlugSettlement", {
  from: [SlugClaim, Project],
  on: [ProjectSlugReserved, ProjectSlugClaimed, ProjectSlugChanged],
}) {}

export const SlugSettlementLive = SlugSettlement.toLayer(
  Effect.gen(function* () {
    const claims = yield* SlugClaim;
    const projects = yield* Project;
    return Effect.fn(
      function* ({ source, event }) {
        if (source.aggregate === "Project") {
          if (event._tag === "ProjectSlugChanged")
            yield* claims.send(event.from, new ReleaseSlug({ project: source.id }));
          return;
        }
        if (event._tag === "ProjectSlugChanged") return;
        const slug = source.id;
        const release = () => claims.send(slug, new ReleaseSlug({ project: event.project }));
        if (event._tag === "ProjectSlugReserved") {
          const { name, status, description, by } = event;
          yield* projects
            .send(event.project, new OpenProject({ slug, name, status, description, by }))
            .pipe(Effect.catchTag("ProjectExists", release));
        } else {
          yield* projects
            .send(event.project, new SwitchProjectSlug({ slug, by: event.by }))
            .pipe(Effect.catchTag("ProjectNotFound", release));
        }
      },
      Effect.orDie,
      Effect.provideService(CurrentActor, slugSettler),
    );
  }),
);
