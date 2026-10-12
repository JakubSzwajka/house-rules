import { app } from "./composition/index";
import { routes } from "./delivery/http/routes";
import { startWorker } from "./server/worker";
startWorker();
export const handler = { app, routes };
