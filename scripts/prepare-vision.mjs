// Build-time dependency preparation only. Installed Gullbert never downloads models.
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile, rename, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

if (process.argv.includes("--if-windows") && process.platform !== "win32") {
  process.exit(0);
}
const directory = fileURLToPath(
  new URL("../src-tauri/models/", import.meta.url),
);
const manifest = JSON.parse(
  await readFile(join(directory, "manifest.json"), "utf8"),
);
await mkdir(directory, { recursive: true });
for (const model of manifest.models) {
  const destination = join(directory, model.file);
  let bytes;
  try {
    bytes = await readFile(destination);
  } catch {
    // A clean checkout has no large model binaries.
  }
  if (
    bytes &&
    createHash("sha256").update(bytes).digest("hex") === model.sha256
  ) {
    continue;
  }
  console.log(`Preparing Windows OCR model: ${model.file}`);
  const response = await fetch(`${manifest.baseUrl}/${model.source}`, {
    signal: AbortSignal.timeout(120_000),
  });
  if (!response.ok) {
    throw new Error(`Model download failed: ${response.status}`);
  }
  bytes = Buffer.from(await response.arrayBuffer());
  if (createHash("sha256").update(bytes).digest("hex") !== model.sha256) {
    throw new Error(`Model checksum mismatch: ${model.file}`);
  }
  const temporary = `${destination}.${process.pid}.tmp`;
  try {
    await writeFile(temporary, bytes);
    await rename(temporary, destination);
  } finally {
    await rm(temporary, { force: true });
  }
}
