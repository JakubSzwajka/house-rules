import { showBooking } from "../show-booking/handler";
import { cancelBooking } from "../cancel-booking/handler";
export const checked = [showBooking("b1"), cancelBooking("b1")];
