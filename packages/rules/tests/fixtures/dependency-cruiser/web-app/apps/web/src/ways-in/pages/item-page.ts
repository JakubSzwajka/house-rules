import { runtime } from "@acme/web-runtime/runtime/index";
export const page = (id: string) => runtime.run(id);
