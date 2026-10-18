import "./browser-policy.js";
import { native, invoke } from "../../platform/bridge.js";

// WebView2 applies these settings on the next top-level navigation. Do not start
// the pet application or signal pet_ready until that protected document loads.
if (native) {
  await invoke("prepare_pet_browser");
}

window.location.replace("pet.html");
