import { app } from "../../composition/index";
import { app as viaUseCase } from "../show";
export const same = app === viaUseCase;
