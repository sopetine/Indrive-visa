import { spawnSync } from "node:child_process";
import http from "node:http";

const server = http.createServer((_request, response) => {
  response.writeHead(200, { "content-type": "text/plain" });
  response.end("unrelated server\n");
});
let ownsServer = true;
try {
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(4173, "127.0.0.1", resolve);
  });
} catch (error) {
  if (error.code !== "EADDRINUSE") throw error;
  ownsServer = false;
}
console.log(ownsServer
  ? "Started unrelated HTTP fixture on 127.0.0.1:4173"
  : "Using preexisting listener on 127.0.0.1:4173");

try {
  const test = spawnSync("npm", ["test"], { encoding: "utf8", env: process.env });
  process.stdout.write(test.stdout ?? "");
  process.stderr.write(test.stderr ?? "");
  if (test.status !== 0) process.exitCode = test.status ?? 1;

  const probe = await new Promise((resolve) => {
    const request = http.get("http://127.0.0.1:4173/", { timeout: 2_000 }, (response) => {
      response.resume();
      response.on("end", () => resolve(response.statusCode === 200));
    });
    request.on("error", () => resolve(false));
    request.on("timeout", () => { request.destroy(); resolve(false); });
  });
  if (!probe) {
    console.error("The unrelated server on 127.0.0.1:4173 did not return HTTP 200 after npm test");
    process.exitCode = 1;
  } else {
    console.log("Unrelated HTTP server returned HTTP 200 after npm test");
  }
} finally {
  if (ownsServer) await new Promise((resolve) => server.close(resolve));
}
