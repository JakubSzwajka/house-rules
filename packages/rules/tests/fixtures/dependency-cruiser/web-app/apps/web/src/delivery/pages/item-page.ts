import { runtime } from "../../server/runtime/index";
export const page = (id: string) => runtime.run(id);
