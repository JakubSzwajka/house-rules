import { MyStuff } from "./facade.ts";
import { MyStuffOperations } from "./booking/operations.ts";
import { bindMyStuff } from "./booking/bind-my-stuff.ts";
import type { MountDefinition } from "@house-rules/application";
export const MyStuffMount = {
  service: MyStuff,
  operations: Object.values(MyStuffOperations),
  bind: bindMyStuff,
} satisfies MountDefinition<MyStuff, MyStuff["Service"]>;
export { MyStuff };
export { bindMyStuff } from "./booking/bind-my-stuff.ts";
export { MyStuffOperations } from "./booking/operations.ts";
export { MyBooking, ReadUnavailable, ReadCallerDenied } from "./booking/my-bookings.ts";
export { MyBookingStore } from "./storage.ts";
export { postgresMyBookingStore } from "./adapters/postgres/my-bookings.ts";
