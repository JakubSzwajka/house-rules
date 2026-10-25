import { showItem } from "../../../../apps/web/src/features/show-item/handler";
export const runtime = { run: (id: string) => showItem(id) };
