import { Gullbert } from "../../simulation/engine.js";
import { native, invoke } from "../../platform/bridge.js";
import { createAudioPlayer } from "../../platform/audio.js";
import { PetApplication } from "./application.js";
import { PetBrowser, PetView } from "./browser-adapters.js";
import type { ApplicationDependencies } from "./application-contracts.js";

const memoryKey = "gullbert.roommate.v1";
let nativeDependency: ApplicationDependencies["native"] = null;
if (native) {
  nativeDependency = {
    invoke,
    listen: native.event.listen.bind(native.event),
  };
}

const application = new PetApplication({
  simulation: new Gullbert(innerWidth, innerHeight),
  browser: new PetBrowser(window, document),
  view: new PetView(document),
  native: nativeDependency,
  storage: {
    load: () => {
      if (native) {
        return invoke("load_roommate");
      }
      return JSON.parse(localStorage.getItem(memoryKey) ?? "null");
    },
    save: (memory) => {
      if (native) {
        return invoke("save_roommate", { memory });
      }
      localStorage.setItem(memoryKey, JSON.stringify(memory));
    },
  },
  clock: {
    now: () => {
      return performance.now();
    },
    wallNow: () => {
      return Date.now();
    },
    schedule: (callback, delay, ...args) => {
      return setTimeout(callback, delay, ...args);
    },
    cancel: (timer) => {
      clearTimeout(timer);
    },
  },
  audio: createAudioPlayer(),
  reportError: (error) => {
    console.error(error);
  },
});

if (!native) {
  const playground = document.getElementById("typing-playground");
  if (playground) {
    playground.hidden = false;
  }
}
await application.start();
