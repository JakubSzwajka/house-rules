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
    ...Object.values(PartyOperations),
    ...Object.values(IdentityOperations),
  ],
  features: Object.values(Features),
  ways: [
    {
      name: "web",
      path: "/api",
      features: [
        Features.signUp,
        Features.signIn,
        Features.signOut,
        Features.changePassword,
        Features.makeBooking,
        Features.showBooking,
        Features.myBookings,
        Features.cancelBooking,
        Features.defineRole,
        Features.listRoles,
        Features.assignRole,
        Features.revokeRole,
      ],
    },
    { name: "partner", path: "/partner", features: [Features.partnerBooking] },
    { name: "mcp", path: "/mcp", features: [Features.showBooking, Features.myBookings] },
  ],
};
export const registryMarkdown = () => renderRegistry(registryData);
