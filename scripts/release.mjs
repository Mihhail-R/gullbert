import {
  readFileSync,
  writeFileSync,
  readdirSync,
  mkdirSync,
  copyFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const targets = {
  "aarch64-apple-darwin": "darwin-aarch64",
  "x86_64-apple-darwin": "darwin-x86_64",
  "x86_64-pc-windows-msvc": "windows-x86_64",
};
export function checkVersion(tag, directory = root) {
  const read = (file) =>
    JSON.parse(readFileSync(path.join(directory, file), "utf8"));
  const version = read("package.json").version;
  const cargo = readFileSync(
    path.join(directory, "src-tauri/Cargo.toml"),
    "utf8",
  ).match(/^version = "([^"]+)"/m)?.[1];
  const lock = readFileSync(
    path.join(directory, "src-tauri/Cargo.lock"),
    "utf8",
  ).match(/name = "gullbert"\r?\nversion = "([^"]+)"/)?.[1];
  if (
    [
      read("src-tauri/tauri.conf.json").version,
      read("package-lock.json").version,
      read("package-lock.json").packages[""].version,
      cargo,
      lock,
    ].some((value) => value !== version)
  ) {
    throw new Error("Package, lockfile, Rust, and Tauri versions must match.");
  }
  if (tag && tag !== `v${version}`) {
    throw new Error(`Release tag ${tag} must match v${version}.`);
  }
  return version;
}
export function prepareRelease(tag, directory = root) {
  const numeric = "(?:0|[1-9][0-9]*)";
  const prerelease = `(?:${numeric}|[0-9]*[a-zA-Z-][0-9a-zA-Z-]*)`;
  const pattern = new RegExp(
    `^v${numeric}\\.${numeric}\\.${numeric}(?:-${prerelease}(?:\\.${prerelease})*)?(?:\\+[0-9a-zA-Z-]+(?:\\.[0-9a-zA-Z-]+)*)?$`,
  );
  if (typeof tag !== "string" || tag.trim() !== tag || !pattern.test(tag)) {
    throw new Error(
      `Invalid release tag: ${JSON.stringify(tag)}. Expected v<semver>, for example v0.3.0-beta.5.`,
    );
  }
  // Catch broken source metadata before changing any files. The tag supplies
  // the release version; branch versions only need to agree with each other.
  checkVersion(undefined, directory);
  const version = tag.slice(1);
  const updates = new Map();
  for (const file of [
    "package.json",
    "package-lock.json",
    "src-tauri/tauri.conf.json",
  ]) {
    const content = readFileSync(path.join(directory, file), "utf8");
    const data = JSON.parse(content);
    data.version = version;
    if (file === "package-lock.json") data.packages[""].version = version;
    updates.set(
      file,
      (JSON.stringify(data, null, 2) + "\n").replace(
        /\n/g,
        content.includes("\r\n") ? "\r\n" : "\n",
      ),
    );
  }
  for (const [file, pattern] of [
    ["src-tauri/Cargo.toml", /(^version = ")[^"]+("\r?$)/m],
    ["src-tauri/Cargo.lock", /(name = "gullbert"\r?\nversion = ")[^"]+(")/],
  ]) {
    updates.set(
      file,
      readFileSync(path.join(directory, file), "utf8").replace(
        pattern,
        (_, prefix, suffix) => `${prefix}${version}${suffix}`,
      ),
    );
  }
  for (const [file, content] of updates)
    writeFileSync(path.join(directory, file), content);
  return checkVersion(tag, directory);
}
function single(directory, suffix) {
  const matches = readdirSync(directory).filter((file) =>
    file.endsWith(suffix),
  );
  if (matches.length !== 1)
    throw new Error(`Expected one ${suffix} in ${directory}`);
  return path.join(directory, matches[0]);
}
export function collect(bundle, destination, target, version) {
  const platform = targets[target];
  if (!platform) throw new Error(`Unsupported release target: ${target}`);
  mkdirSync(destination, { recursive: true });
  const mac = platform.startsWith("darwin");
  const source = single(
    path.join(bundle, mac ? "macos" : "nsis"),
    mac ? ".app.tar.gz" : ".exe",
  );
  const filename = `Gullbert-${version}-${platform}${mac ? ".app.tar.gz" : "-setup.exe"}`;
  const signature = readFileSync(`${source}.sig`, "utf8").trim();
  if (!signature) throw new Error("Missing update signature");
  copyFileSync(source, path.join(destination, filename));
  copyFileSync(`${source}.sig`, path.join(destination, `${filename}.sig`));
  if (mac)
    copyFileSync(
      single(path.join(bundle, "dmg"), ".dmg"),
      path.join(destination, `Gullbert-${version}-${platform}.dmg`),
    );
  const manifest = {
    version,
    platforms: {
      [platform]: {
        signature,
        url: `https://github.com/Mihhail-R/gullbert/releases/download/v${version}/${filename}`,
      },
    },
  };
  writeFileSync(
    path.join(destination, `${platform}.json`),
    JSON.stringify(manifest, null, 2) + "\n",
  );
  return manifest;
}
export function merge(directory, version) {
  const platforms = {};
  for (const platform of Object.values(targets)) {
    const shard = JSON.parse(
      readFileSync(path.join(directory, `${platform}.json`), "utf8"),
    );
    if (shard.version !== version || !shard.platforms[platform]?.signature) {
      throw new Error(`Invalid release metadata for ${platform}`);
    }
    Object.assign(platforms, shard.platforms);
  }
  const manifest = {
    version,
    notes: `Gullbert ${version}`,
    pub_date: new Date().toISOString(),
    platforms,
  };
  writeFileSync(
    path.join(directory, "latest.json"),
    JSON.stringify(manifest, null, 2) + "\n",
  );
  return manifest;
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const [command, argument, directory] = process.argv.slice(2);
  if (command === "prepare") {
    const version = prepareRelease(
      argument,
      directory ? path.resolve(directory) : root,
    );
    console.log(`Prepared release v${version}.`);
  } else {
    const version = checkVersion(
      process.env.RELEASE_TAG ||
        (process.env.GITHUB_REF_TYPE === "tag"
          ? process.env.GITHUB_REF_NAME
          : undefined),
    );
    if (command === "collect") {
      collect(
        path.join(root, "src-tauri/target", argument, "release/bundle"),
        path.join(root, "dist"),
        argument,
        version,
      );
    } else if (command === "merge") {
      merge(path.resolve(argument), version);
    } else if (command !== "check") {
      throw new Error(
        "Usage: release.mjs prepare <tag> [directory] | check | collect <target> | merge <directory>",
      );
    }
  }
}
