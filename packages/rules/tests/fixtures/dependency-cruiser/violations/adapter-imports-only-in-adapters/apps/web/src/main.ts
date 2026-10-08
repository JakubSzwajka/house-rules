import { NodeServices } from "@effect/platform-node";
import { listTrips } from "@acme/trips";

export const app = [NodeServices, listTrips];
