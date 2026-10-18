import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { collect, merge, checkVersion } from "../scripts/release.mjs";

// Keep dependency and unrelated metadata versions equal to the starting app
// version. Release stamping must change only the app's own version fields.
const versionTemplates = {
  "package.json": `{
  "name": "gullbert",
  "version": "APP_VERSION",
  "description": "1.0.0-beta.2",
  "dependencies": {
    "gensync": "1.0.0-beta.2"
  }
}
`,
  "package-lock.json": `{
  "name": "gullbert",
  "version": "APP_VERSION",
  "lockfileVersion": 3,
  "packages": {
    "": {
      "name": "gullbert",
      "version": "APP_VERSION",
      "dependencies": {
        "gensync": "1.0.0-beta.2"
      }
    },
    "node_modules/gensync": {
      "version": "1.0.0-beta.2"
    }
  }
}
`,
  "src-tauri/Cargo.toml": `[package]
name = "gullbert"
version = "APP_VERSION"

[dependencies]
fixture = "1.0.0-beta.2"
`,
  "src-tauri/Cargo.lock": `version = 4

[[package]]
name = "fixture"
version = "1.0.0-beta.2"

[[package]]
name = "gullbert"
version = "APP_VERSION"
`,
  "src-tauri/tauri.conf.json": `{
  "productName": "Gullbert",
  "version": "APP_VERSION"
}
`,
};
const versionFiles = Object.keys(versionTemplates);

function versionContents(version, newline) {
  return Object.values(versionTemplates)
    .map((template) => template
      .replaceAll("APP_VERSION", version)
      .replaceAll("\n", newline));
}

function versionFixture(newline = "\n") {
  const directory = mkdtempSync(path.join(tmpdir(), "gullbert-version-"));
  mkdirSync(path.join(directory, "src-tauri"));
  const contents = versionContents("1.0.0-beta.2", newline);

  for (const [index, file] of versionFiles.entries()) {
    writeFileSync(path.join(directory, file), contents[index]);
  }

  return directory;
}

function prepare(directory, tag, refType = "tag") {
  return spawnSync(
    process.execPath,
    [
      fileURLToPath(new URL("../scripts/release.mjs", import.meta.url)),
      "prepare",
      tag,
      directory,
    ],
    {
      encoding: "utf8",
      env: { ...process.env, GITHUB_REF_TYPE: refType, GITHUB_REF_NAME: tag },
    },
  );
}

for (const newline of ["\n", "\r\n"]) {
  const description = "release preparation preserves matching dependency versions";

  test(`${description} (${JSON.stringify(newline)})`, () => {
    const directory = versionFixture(newline);

    try {
      const result = prepare(directory, "v0.3.0-beta.5");
      assert.equal(result.status, 0, result.stderr);
      assert.equal(checkVersion("v0.3.0-beta.5", directory), "0.3.0-beta.5");

      // No dependencies or other config may change, including line endings.
      const after = versionFiles.map((file) =>
        readFileSync(path.join(directory, file), "utf8"),);
      assert.deepEqual(after, versionContents("0.3.0-beta.5", newline));

      assert.equal(prepare(directory, "v0.3.0-beta.5", "branch").status, 0);
      assert.deepEqual(
        versionFiles.map((file) =>
          readFileSync(path.join(directory, file), "utf8"),),
        after,
      );
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
}

test("release preparation rejects invalid tags and inconsistent source before writing", () => {
  const directory = versionFixture();

  try {
    const before = versionFiles.map((file) =>
      readFileSync(path.join(directory, file), "utf8"),);

    for (const tag of [
      "",
      "main",
      "0.3.0",
      "v01.3.0",
      "v0.3.0-beta.05",
      "v0.3.0-",
      "v0.3.0\n",
    ]) {
      const result = prepare(directory, tag);
      assert.notEqual(result.status, 0, tag);
      assert.match(result.stderr, /Invalid release tag/);
    }

    assert.deepEqual(
      versionFiles.map((file) =>
        readFileSync(path.join(directory, file), "utf8"),),
      before,
    );
    writeFileSync(
      path.join(directory, "src-tauri/tauri.conf.json"),
      '{"version":"99.0.0"}\n',
    );
    const result = prepare(directory, "v0.3.0-beta.5");
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /versions must match/);
    assert.equal(
      readFileSync(path.join(directory, "package.json"), "utf8"),
      before[0],
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("release collection packages only Apple Silicon and Windows x64 with signatures", () => {
  const root = mkdtempSync(path.join(tmpdir(), "gullbert-release-"));

  try {
    const destination = path.join(root, "dist");

    for (const target of [
      "aarch64-apple-darwin",
      "x86_64-pc-windows-msvc",
    ]) {
      const bundle = path.join(root, target);
      const mac = target.endsWith("darwin");
      const directory = path.join(bundle, mac ? "macos" : "nsis");
      mkdirSync(directory, { recursive: true });
      const artifact = path.join(
        directory,
        mac ? "Gullbert.app.tar.gz" : "Gullbert.exe",
      );
      writeFileSync(artifact, target);
      writeFileSync(`${artifact}.sig`, `signature-${target}`);

      if (mac) {
        mkdirSync(path.join(bundle, "dmg"));
        writeFileSync(path.join(bundle, "dmg/Gullbert.dmg"), "installer");
      }

      collect(bundle, destination, target, "0.3.0-beta.1");
    }

    const manifest = merge(destination, "0.3.0-beta.1");
    const platforms = Object.keys(manifest.platforms)
      .sort();
    assert.deepEqual(platforms, [
      "darwin-aarch64",
      "windows-x86_64",
    ]);
    assert.match(
      manifest.platforms["darwin-aarch64"].url,
      /v0.3.0-beta.1\/Gullbert-0.3.0-beta.1-darwin-aarch64.app.tar.gz$/,
    );
    assert.equal(
      manifest.platforms["darwin-aarch64"].signature,
      "signature-aarch64-apple-darwin",
    );
    assert.equal(
      manifest.platforms["windows-x86_64"].signature,
      "signature-x86_64-pc-windows-msvc",
    );
    assert.throws(
      () => collect(root, destination, "x86_64-apple-darwin", "0.3.0-beta.1"),
      /Unsupported release target: x86_64-apple-darwin/,
    );
    assert.throws(
      () => merge(destination, "0.4.0"),
      /Invalid release metadata/,
    );
    rmSync(path.join(destination, "windows-x86_64.json"));
    assert.throws(() => merge(destination, "0.3.0-beta.1"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("release tags must agree with all embedded versions", () => {
  const version = checkVersion();
  assert.equal(checkVersion(`v${version}`), version);
  assert.throws(() => checkVersion("v99.0.0"), /must match/);
});

test("release validation accepts Windows CRLF checkouts and still catches mismatches", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "gullbert-crlf-"));

  try {
    mkdirSync(path.join(directory, "src-tauri"));

    for (const file of [
      "package.json",
      "package-lock.json",
      "src-tauri/Cargo.toml",
      "src-tauri/Cargo.lock",
      "src-tauri/tauri.conf.json",
    ]) {
      const content = readFileSync(
        new URL(`../${file}`, import.meta.url),
        "utf8",
      );
      writeFileSync(
        path.join(directory, file),
        content.replace(/\r?\n/g, "\r\n"),
      );
    }

    const version = checkVersion();
    assert.equal(checkVersion(`v${version}`, directory), version);
    writeFileSync(
      path.join(directory, "src-tauri/Cargo.lock"),
      '[[package]]\r\nname = "gullbert"\r\nversion = "99.0.0"\r\n',
    );
    assert.throws(
      () => checkVersion(undefined, directory),
      /versions must match/,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
