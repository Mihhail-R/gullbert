import { cpSync, mkdtempSync, renameSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { frontendRoot } from "./build.mjs";

export const pagesRoot = fileURLToPath(new URL("../pages-dist", import.meta.url));

/** Publish the playground at the site root without changing Tauri's entry point. */
export function buildPages(destination = pagesRoot) {
  const staging = mkdtempSync(path.join(path.dirname(destination), ".pages-build-"));

  try {
    cpSync(frontendRoot, staging, { recursive: true });
    cpSync(path.join(staging, "playground.html"), path.join(staging, "index.html"));
    rmSync(destination, { recursive: true, force: true });
    renameSync(staging, destination);
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  buildPages();
}
