import { validateDialogue } from "./dialogue.mjs";
import {
  readFileSync,
  writeFileSync,
  cpSync,
  mkdtempSync,
  renameSync,
  rmSync,
  watch,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const project = fileURLToPath(new URL("../", import.meta.url));
const source = path.join(project, "src");
export const frontendRoot = path.join(project, "web-dist");

export function buildFrontend() {
  // Build a complete snapshot first. Errors leave the last working preview
  // intact; successful builds remove stale files, including nested modules.
  const staging = mkdtempSync(path.join(project, ".web-build-"));
  try {
    const catalog = JSON.parse(
      readFileSync(path.join(source, "simulation/dialogue.json"), "utf8"),
    );
    validateDialogue(catalog);
    const result = spawnSync(
      process.execPath,
      [
        path.join(project, "node_modules/typescript/bin/tsc"),
        "--outDir",
        staging,
      ],
      { cwd: project, stdio: "inherit" },
    );
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error("Frontend type checking failed");
    cpSync(source, staging, {
      recursive: true,
      filter: (file) => !file.endsWith(".ts"),
    });
    // Emit ordinary ESM so older desktop WebViews need no JSON-module support.
    // TypeScript checks the source JSON import; this embeds that same catalog.
    writeFileSync(
      path.join(staging, "simulation/dialogue.js"),
      `export const dialogue = ${JSON.stringify(catalog)};\n`,
    );
    rmSync(frontendRoot, { recursive: true, force: true });
    renameSync(staging, frontendRoot);
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}

export function watchFrontend() {
  let timer;
  const rebuild = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      try {
        buildFrontend();
        console.log("Frontend rebuilt. Refresh the playground to see changes.");
      } catch (error) {
        console.error(error.message);
      }
    }, 100);
  };
  const watcher = watch(source, { recursive: true }, rebuild);
  const configWatcher = watch(path.join(project, "tsconfig.json"), rebuild);
  return () => {
    clearTimeout(timer);
    watcher.close();
    configWatcher.close();
  };
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  buildFrontend();
  if (process.argv.includes("--watch")) watchFrontend();
}
