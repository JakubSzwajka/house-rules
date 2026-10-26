import { Features } from "../../features/index.ts";
import { ReadModels } from "../../read-models/index.ts";
import { mcpWho, resourceOf } from "../../composition/sign-in.ts";
import { defineWay, Mean } from "@house-rules/application";
const resource = resourceOf("https://booking.example", "");
const features = [ReadModels.showBooking, ReadModels.myBookings] as const;
export const mcpWay = defineWay({
  name: "mcp",
  path: "/mcp",
  protocol: "mcp",
  features,
  who: mcpWho(resource),
  mean: Mean.elicitation,
  resource,
  server: { name: "booking", version: "0.0.0" },
  tools: [
    {
      feature: ReadModels.showBooking,
      title: "Show your booking",
      idempotent: true,
      openWorld: false,
    },
    {
      feature: ReadModels.myBookings,
      title: "List your bookings and payments",
      idempotent: true,
      openWorld: false,
    },
  ],
});
