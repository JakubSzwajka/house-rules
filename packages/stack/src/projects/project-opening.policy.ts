import * as Domain from "@alchemy.run/domain";
import * as Effect from "effect/Effect";
import { CurrentActor } from "../actor/current-actor.context.ts";
import { SlugClaimed } from "./change-project-slug.command.ts";
import { SlugReserved } from "./create-project.command.ts";
import { OpenProject } from "./open-project.command.ts";
import { slugSettler } from "./permissions.ts";
import { Project } from "./project.aggregate.ts";
import { ReleaseSlug } from "./release-slug.command.ts";
import { SlugClaim } from "./slug-claim.aggregate.ts";
import { SwitchProjectSlug } from "./switch-project-slug.command.ts";

export class ProjectOpening extends Domain.Policy("ProjectOpening", {
  from: SlugClaim,
  on: [SlugReserved, SlugClaimed],
}) {}

export const ProjectOpeningLive = ProjectOpening.toLayer(
  Effect.gen(function* () {
    const claims = yield* SlugClaim;
    const projects = yield* Project;
    return Effect.fn(
      function* ({ source, event }) {
        const slug = source.id;
        const release = () => claims.send(slug, new ReleaseSlug({ project: event.project }));
        if (event._tag === "SlugReserved") {
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
