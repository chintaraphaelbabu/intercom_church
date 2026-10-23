import type http from "node:http";

let activeInputRoute = "Wired Headset";
let activeOutputRoute = "Wired Headset";

export function setActiveRoutes(input: string, output: string) {
  activeInputRoute = input;
  activeOutputRoute = output;
}

export async function diagnosticsHandler(request: http.IncomingMessage, response: http.ServerResponse): Promise<boolean> {
  if (request.url === "/api/diagnostics/routes" || request.url?.startsWith("/api/diagnostics/routes")) {
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({
      inputRoute: activeInputRoute,
      outputRoute: activeOutputRoute,
      timestamp: new Date().toISOString(),
    }));
    return true;
  }
  return false;
}
