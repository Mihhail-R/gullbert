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
import { collect, merge, checkVersion } from "../scripts/release.mjs";

test("release collection preserves distinct architectures and signatures", () => {
  const root = mkdtempSync(path.join(tmpdir(), "gullbert-release-"));
  try {
    const destination = path.join(root, "dist");
    for (const target of [
      "aarch64-apple-darwin",
      "x86_64-apple-darwin",
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
    assert.equal(Object.keys(manifest.platforms).length, 3);
    assert.match(
      manifest.platforms["darwin-aarch64"].url,
      /v0.3.0-beta.1\/Gullbert-0.3.0-beta.1-darwin-aarch64.app.tar.gz$/,
    );
    assert.equal(
      manifest.platforms["darwin-x86_64"].signature,
      "signature-x86_64-apple-darwin",
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
