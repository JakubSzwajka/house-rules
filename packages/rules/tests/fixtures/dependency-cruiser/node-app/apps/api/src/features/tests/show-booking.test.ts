import { app } from "../../composition/index";
import { showBooking } from "../show-booking/handler";
export const shown = [app, showBooking("b-1")];
