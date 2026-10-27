import * as fs from "node:fs";
import path from "node:path";
import { readAppsRoot } from "./layout-config.mjs";

export const readModels = (workspaces) =>
  workspaces
    .filter((workspace) => readAppsRoot(process.cwd()).test(`${workspace}/`))
    .flatMap((workspace) =>
      ["read-models", "projections"].flatMap((area) => {
        const directory = path.resolve(workspace, "src", area);
        if (!fs.existsSync(directory)) return [];
        return fs
          .readdirSync(directory, { withFileTypes: true })
          .filter((entry) => entry.isDirectory())
          .map((entry) => ({
            directory: path.join(directory, entry.name),
            owner: path
              .relative(process.cwd(), path.join(directory, entry.name))
              .split(path.sep)
              .join("/"),
          }));
      }),
    );
