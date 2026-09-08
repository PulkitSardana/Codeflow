import fastify from "fastify";

const app = fastify();

app.get("/checkout/:id", async (request) => {
  await delay(10);
  return { ok: true, id: request.params.id };
});

await app.listen({ host: "127.0.0.1", port: 0 });

try {
  const address = app.server.address();
  if (!address || typeof address === "string") {
    throw new Error("Could not bind Fastify fixture");
  }
  const result = await fetch(`http://127.0.0.1:${address.port}/checkout/123`);
  console.log("fastify-status", result.status);
  await result.json();
} finally {
  await app.close();
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
