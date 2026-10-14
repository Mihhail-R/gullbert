import http from "node:http";
import { readFile } from "node:fs/promises";
import { buildFrontend, watchFrontend, frontendRoot } from "./build.mjs";
import path from "node:path";
buildFrontend();
watchFrontend();
const root = frontendRoot;
const mime = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};
http
  .createServer(async (req, res) => {
    const pathname = decodeURIComponent(
      new URL(req.url, "http://localhost").pathname,
    );
    const file = path.resolve(
      root,
      `.${pathname === "/" ? "/index.html" : pathname}`,
    );
    if (!file.startsWith(root + path.sep)) {
      res.writeHead(403).end();
      return;
    }
    try {
      const content = await readFile(file);
      res.writeHead(200, {
        "Content-Type": mime[path.extname(file)] || "application/octet-stream",
      });
      res.end(content);
    } catch {
      res.writeHead(404).end("Not found");
    }
  })
  .listen(Number(process.env.PORT ?? 4173), "127.0.0.1", function () {
    console.log(`Gullbert preview: http://127.0.0.1:${this.address().port}`);
  });
