import { appMapSources } from "@house-rules/rules/app-map";
import type { AppMapSnapshot } from "@house-rules/application";

export const mapSources = (
  snapshot: AppMapSnapshot,
  appDirectory: string,
  rootDirectory: string,
): Promise<AppMapSnapshot> =>
  appMapSources(snapshot, {
    appDirectory,
    rootDirectory,
    packageRoots: ["packages", "examples/booking/packages"],
  });

export const appDirectory = new URL("../", import.meta.url).pathname;
export const rootDirectory = new URL("../../../../", new URL(`file://${appDirectory}`)).pathname;
