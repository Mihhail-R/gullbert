import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildFrontend } from "./build.mjs";

const project = fileURLToPath(new URL("../", import.meta.url));
buildFrontend();
const native = spawnSync(
  "cargo",
  [
    "test",
    "--manifest-path",
    "src-tauri/Cargo.toml",
    "--locked",
    ...process.argv.slice(2),
    "native_input::tests::application_routing_traces",
    "--",
    "--exact",
    "--nocapture",
  ],
  { cwd: project, encoding: "utf8" },
);
if (native.error) throw native.error;
if (native.status !== 0) {
  process.stderr.write(native.stderr + native.stdout);
  process.exit(native.status ?? 1);
}
const trace = native.stdout
  .split("\n")
  .find((line) => line.startsWith("GULLBERT_ROUTING_TRACES="));
if (!trace)
  throw new Error("Native routing test did not produce application traces");
const directory = mkdtempSync(path.join(tmpdir(), "gullbert-routing-"));
try {
  const file = path.join(directory, "traces.json");
  writeFileSync(file, trace.slice("GULLBERT_ROUTING_TRACES=".length));
  const tests = spawnSync(
    process.execPath,
    ["--test", "tests/action-routing.test.mjs"],
    {
      cwd: project,
      stdio: "inherit",
      env: { ...process.env, GULLBERT_ROUTING_TRACES: file },
    },
  );
  if (tests.error) throw tests.error;
  process.exitCode = tests.status ?? 1;
} finally {
  rmSync(directory, { recursive: true, force: true });
}
