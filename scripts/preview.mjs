import http from "node:http";
import { readFile } from "node:fs/promises";
import { buildFrontend, watchFrontend, frontendRoot } from "./build.mjs";
import { fileURLToPath } from "node:url";
import path from "node:path";
const mime = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};
export function createPreviewServer(root = frontendRoot) {
  return http.createServer(async (req, res) => {
    let pathname;

    try {
      pathname = decodeURIComponent(
        new URL(req.url, "http://localhost").pathname,
      );
    } catch {
      res.writeHead(400)
        .end("Bad request");
      return;
    }

    const file = path.resolve(
      root,
      `.${pathname === "/" ? "/index.html" : pathname}`,
    );

    if (!file.startsWith(root + path.sep)) {
      res.writeHead(403)
        .end();
      return;
    }

    try {
      const content = await readFile(file);
      res.writeHead(200, {
        "Content-Type": mime[path.extname(file)] || "application/octet-stream",
      });
      res.end(content);
    } catch {
      res.writeHead(404)
        .end("Not found");
    }
  });
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  buildFrontend();
  const stopWatching = watchFrontend();
  const server = createPreviewServer();
  server.on("close", stopWatching);
  server.listen(Number(process.env.PORT ?? 4173), "127.0.0.1", function () {
    console.log(`Gullbert preview: http://127.0.0.1:${this.address().port}`);
  });
}
