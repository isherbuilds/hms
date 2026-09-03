import { createFsDrain } from "evlog/fs";
import { definePlugin } from "nitro";

export default definePlugin((nitroApp) => {
  if (!import.meta.dev) return;
  nitroApp.hooks.hook("evlog:drain", createFsDrain());
});
