import { app } from "../../composition/index";
import { showItem } from "../show-item/handler";
export const shown = showItem(app.name);
