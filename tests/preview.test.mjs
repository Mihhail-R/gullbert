import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { once } from "node:events";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createPreviewServer } from "../scripts/preview.mjs";

async function playground(t) {
  const directory = await mkdtemp(path.join(tmpdir(), "gullbert-preview-"));
  const root = path.join(directory, "web-dist");
  t.after(() => rm(directory, { recursive: true, force: true }));
  await mkdir(root);
  await writeFile(path.join(root, "index.html"), "<h1>Gullbert</h1>");
  await writeFile(path.join(root, "pet.js"), "export const gull = true;");
  await writeFile(path.join(directory, "outside.txt"), "outside the preview");
  const server = createPreviewServer(root);
  t.after(() => new Promise((resolve) => server.close(resolve)));
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return function request(requestPath) {
    return new Promise((resolve, reject) => {
      http
        .get(
          {
            hostname: "127.0.0.1",
            port: server.address().port,
            path: requestPath,
            agent: false,
          },
          (response) => {
            let body = "";
            response.setEncoding("utf8");
            response.on("data", (chunk) => {
              body += chunk;
            });
            response.on("end", () => {
              resolve({
                status: response.statusCode,
                type: response.headers["content-type"],
                body,
              });
            });
            response.on("error", reject);
          },
        )
        .on("error", reject);
    });
  };
}

test("preview serves the entry point and modules, including query strings", async (t) => {
  const request = await playground(t);
  assert.deepEqual(await request("/?reload=1"), {
    status: 200,
    type: "text/html",
    body: "<h1>Gullbert</h1>",
  });
  assert.deepEqual(await request("/pet.js"), {
    status: 200,
    type: "text/javascript",
    body: "export const gull = true;",
  });
});

test("malformed preview URLs return 400 without stopping subsequent requests", async (t) => {
  const request = await playground(t);
  for (const requestPath of ["/%", "/%E0%A4%A", "http://["]) {
    assert.equal((await request(requestPath)).status, 400);
    assert.equal((await request("/")).status, 200);
  }
});

test("preview refuses encoded traversal and returns 404 for missing files", async (t) => {
  const request = await playground(t);
  assert.equal((await request("/..%2foutside.txt")).status, 403);
  assert.equal((await request("/missing.js")).status, 404);
  assert.equal((await request("/")).status, 200);
});
