import { makeBooking } from "../features/make-booking/node.ts";
import { partnerBooking } from "../features/book-for-partner/node.ts";
import { cancelBooking } from "../features/cancel-booking/node.ts";
import { showBooking } from "../features/show-booking/node.ts";
import { myBookings } from "../features/my-bookings/node.ts";
import { firstSignInNode } from "../features/first-sign-in/node.ts";
import { nightlyCleanupNode } from "../features/nightly-cleanup/node.ts";
import { renderRegistry } from "@house-rules/application";
import { BookingsNodes } from "@example/bookings/contract";
import { BillingNodes } from "@example/billing/contract";
import { MyStuffNodes } from "../read-models/my-bookings/contract.ts";
import { createPerson } from "@house-rules/party/contract";
import { bindLogin } from "@house-rules/identity/contract";
import { Entries } from "./entries.ts";
export const registryData = {
  nodes: [
    ...Object.values(BookingsNodes),
    ...Object.values(BillingNodes),
    ...Object.values(MyStuffNodes),
    createPerson,
    bindLogin,
    makeBooking,
    partnerBooking,
    cancelBooking,
    showBooking,
    myBookings,
    firstSignInNode,
    nightlyCleanupNode,
  ],
  entries: Object.values(Entries),
  ways: [
    {
      name: "web",
      path: "/api",
      entries: [
        Entries.makeBooking,
        Entries.showBooking,
        Entries.myBookings,
        Entries.cancelBooking,
      ],
    },
    { name: "partner", path: "/partner", entries: [Entries.partnerBooking] },
    { name: "mcp", path: "/mcp", entries: [Entries.showBooking, Entries.myBookings] },
  ],
};
export const registryMarkdown = () => renderRegistry(registryData);
