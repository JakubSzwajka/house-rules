import { tool } from "@house-rules/application";
import { listComments } from "../../use-cases/comments/list-comments.js";
import { showBooking } from "../../use-cases/show-booking.js";

export const mcpTools = [
  tool(showBooking, { title: "Show a booking", idempotent: true, openWorld: false }),
  tool(listComments, { title: "List comments on a booking", idempotent: true, openWorld: false }),
] as const;
