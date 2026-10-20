import { app } from "../../composition/index";
import { app as viaUseCase } from "../show/handler";
export const same = app === viaUseCase;
