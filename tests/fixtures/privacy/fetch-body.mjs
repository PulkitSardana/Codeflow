import http from "node:http";
import { trace } from "@codeflow/core";

const server = http.createServer(async (request, response) => {
  if (request.url?.startsWith("/echo")) {
    for await (const _chunk of request) {
      // Drain the request body so fetch completes normally.
    }
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ ok: true, refreshToken: "server-secret" }));
    return;
  }

  response.writeHead(404);
  response.end();
});

await new Promise((resolve, reject) => {
  server.once("error", reject);
  server.listen(0, "127.0.0.1", resolve);
});

try {
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Could not bind privacy fixture");
  }

  await trace("PrivacyFixture.run", async () => {
    const response = await fetch(`http://127.0.0.1:${address.port}/echo?access_token=query-secret`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer header-secret"
      },
      body: JSON.stringify({
        userId: "user_123",
        password: "body-secret"
      })
    });
    await response.json();
  });
} finally {
  await new Promise((resolve) => server.close(resolve));
}
