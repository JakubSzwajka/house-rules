import { app } from "./composition/index";
import { routes } from "./ways-in/http/routes";
import { startWorker } from "./composition/worker";
startWorker();
export const handler = { app, routes };
