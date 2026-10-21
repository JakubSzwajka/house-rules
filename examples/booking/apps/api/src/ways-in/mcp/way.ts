import { mcpWho } from "../../composition/callers.ts";
import { resourceOf } from "../../composition/index.ts";
import { defineWay, May, Mean } from "@house-rules/application";
import { agentPermissions } from "../../composition/entries.ts";
import { showBookingEntry } from "../../features/show-booking/entry.ts";
import { myBookingsEntry } from "../../features/my-bookings/entry.ts";
const resource = resourceOf("https://booking.example", "");
const entries = [showBookingEntry, myBookingsEntry] as const;
export const mcpWay = defineWay({
  name: "mcp",
  path: "/mcp",
  protocol: "mcp",
  entries,
  who: mcpWho(resource),
  may: May.fixed(entries, agentPermissions),
  mean: Mean.elicitation,
  resource,
  server: { name: "booking", version: "0.0.0" },
  tools: [
    { entry: showBookingEntry, title: "Show your booking", idempotent: true, openWorld: false },
    {
      entry: myBookingsEntry,
      title: "List your bookings and payments",
      idempotent: true,
      openWorld: false,
    },
  ],
});
