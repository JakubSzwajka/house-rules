import { Actor, ActorId, memoryUnitOfWork } from "@house-rules/domain";
import { Layer } from "effect";
import { Notifications, type NotificationsOptions } from "../index.js";
const actor = (id: string) => Actor.make({ id: ActorId.make(id) });
const options: NotificationsOptions = {
  ...Notifications.presets.default,
  recipientKind: "member",
  categories: [
    { name: "news", defaultChannels: ["inapp", "push", "email"], mandatory: false },
    { name: "security", defaultChannels: ["push", "email"], mandatory: true },
  ],
  maxPageSize: 2,
};
const world = Notifications.layerMemory(options).pipe(Layer.provideMerge(memoryUnitOfWork));
const message = (id: string, category = "news") => ({
  recipients: [{ kind: "member", id }],
  category,
  title: "Title",
  body: "Text",
  data: { ref: "thing" },
});
export const notificationsTesting = { actor, options, world, message };
