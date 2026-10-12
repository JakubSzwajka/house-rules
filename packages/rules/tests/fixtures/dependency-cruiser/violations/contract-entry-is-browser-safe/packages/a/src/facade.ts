import { memoryStore } from "./adapters/memory/booking-store";
import { BookingStore } from "./storage";

export const Bookings = { memoryStore, BookingStore };
