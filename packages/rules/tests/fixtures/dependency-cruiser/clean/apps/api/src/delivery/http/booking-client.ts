import { showBookingContract } from "@acme/bookings/contract";
import { stayContracts } from "@acme/stays/contract";

export const endpoints = [showBookingContract, ...stayContracts];
