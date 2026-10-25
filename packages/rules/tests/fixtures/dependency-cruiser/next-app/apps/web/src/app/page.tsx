import { app } from "../composition/index";
import { showItem } from "../features/show-item/handler";
export default function Page() {
  return showItem(app.name);
}
