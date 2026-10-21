import { Features, agentPermissions } from "../../features/index.ts";
import { mcpWho } from "../../composition/callers.ts";
import { resourceOf } from "../../composition/index.ts";
import { defineWay, May, Mean } from "@house-rules/application";
const resource = resourceOf("https://booking.example", "");
const features = [Features.showBooking, Features.myBookings] as const;
export const mcpWay = defineWay({
  name: "mcp",
  path: "/mcp",
  protocol: "mcp",
  features,
  who: mcpWho(resource),
  may: May.fixed(features, agentPermissions),
  mean: Mean.elicitation,
  resource,
  server: { name: "booking", version: "0.0.0" },
  tools: [
    {
      feature: Features.showBooking,
      title: "Show your booking",
      idempotent: true,
      openWorld: false,
    },
    {
      feature: Features.myBookings,
      title: "List your bookings and payments",
      idempotent: true,
      openWorld: false,
    },
  ],
});
