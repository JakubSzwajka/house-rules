import { readFileSync } from "node:fs";
import { b } from "@acme/b";
import { bShape } from "@acme/b/contract";
import { Effect } from "effect";
import { Client } from "pg";
import { booking } from "./booking/booking";
import { Bookings } from "./facade";

export const contract = [readFileSync, b, bShape, Effect, Client, booking, Bookings];
