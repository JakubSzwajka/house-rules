import { showItem } from "../../use-cases/show-item";
export const runtime = { run: (id: string) => showItem(id) };
