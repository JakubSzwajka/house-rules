import { renderRegistry } from "@house-rules/application";
import { BookingsOperations } from "@example/bookings/contract";
import { BillingOperations } from "@example/billing/contract";
import { MyStuffOperations } from "../read-models/my-bookings/contract.ts";
import { PartyOperations } from "@house-rules/party/contract";
import { IdentityOperations } from "@house-rules/identity/contract";
import { Features } from "../features/index.ts";
export const registryData = {
  operations: [
    ...Object.values(BookingsOperations),
    ...Object.values(BillingOperations),
    ...Object.values(MyStuffOperations),
    PartyOperations.createPerson,
    IdentityOperations.bindLogin,
  ],
  features: Object.values(Features),
  ways: [
    {
      name: "web",
      path: "/api",
      features: [
        Features.makeBooking,
        Features.showBooking,
        Features.myBookings,
        Features.cancelBooking,
      ],
    },
    { name: "partner", path: "/partner", features: [Features.partnerBooking] },
    { name: "mcp", path: "/mcp", features: [Features.showBooking, Features.myBookings] },
  ],
};
export const registryMarkdown = () => renderRegistry(registryData);
