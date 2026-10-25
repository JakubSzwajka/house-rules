import { cancelBooking } from "../../features/cancel-booking/handler";
import { formatId } from "./string-utils";
export const cancelRoute = (id: string) => cancelBooking(formatId(id));
