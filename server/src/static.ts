import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".map": "application/json; charset=utf-8",
};

const MISSING_BUILD =
  "Director app not built. Run `npm run build` in the repository root, then restart the control server.";

export function contentTypeFor(filePath: string): string {
  return MIME_TYPES[path.extname(filePath).toLowerCase()] ?? "application/octet-stream";
}

async function isFile(filePath: string): Promise<boolean> {
  try {
    return (await stat(filePath)).isFile();
  } catch {
    return false;
  }
}

/**
 * Serve the built Director app. Requests without a file extension fall back to
 * index.html so the single-page app can route client-side.
 */
export function createStaticHandler(
  webDist: string,
): (request: IncomingMessage, response: ServerResponse) => Promise<void> {
  const root = path.resolve(webDist);

  return async (request, response): Promise<void> => {
    if (request.method !== "GET" && request.method !== "HEAD") {
      response.writeHead(405, { Allow: "GET, HEAD" });
      response.end("Method not allowed");
      return;
    }

    let pathname: string;
    try {
      pathname = decodeURIComponent(new URL(request.url ?? "/", "http://localhost").pathname);
    } catch {
      response.writeHead(400);
      response.end("Bad request");
      return;
    }

    const resolved = path.resolve(root, `.${pathname}`);
    if (resolved !== root && !resolved.startsWith(root + path.sep)) {
      response.writeHead(404);
      response.end("Not found");
      return;
    }

    let filePath = resolved;
    let found = await isFile(filePath);
    if (!found && path.extname(pathname) === "") {
      filePath = path.join(root, "index.html");
      found = await isFile(filePath);
    }

    if (!found) {
      if (!(await isFile(path.join(root, "index.html")))) {
        response.writeHead(503, { "Content-Type": "text/plain; charset=utf-8" });
        response.end(MISSING_BUILD);
        return;
      }
      response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("Not found");
      return;
    }

    response.writeHead(200, {
      "Content-Type": contentTypeFor(filePath),
      "Cache-Control": path.basename(filePath) === "index.html" ? "no-store" : "public, max-age=3600",
    });
    if (request.method === "HEAD") {
      response.end();
      return;
    }
    createReadStream(filePath).pipe(response);
  };
}
