import { memoryBookingStore } from "../adapters/memory/booking";
import { postgresBookingStore } from "../adapters/postgres/booking";
import { support } from "../adapters/tests/support";
export const cases = [memoryBookingStore, postgresBookingStore, support];
