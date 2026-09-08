import express from "express";

const app = express();

app.get("/checkout/:id", async (request, response) => {
  await delay(12);
  response.json({ ok: true, id: request.params.id });
});

const server = await new Promise((resolve, reject) => {
  const created = app.listen(0, "127.0.0.1", () => resolve(created));
  created.once("error", reject);
});

try {
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Could not bind Express fixture");
  }
  const result = await fetch(`http://127.0.0.1:${address.port}/checkout/123`);
  console.log("express-status", result.status);
  await result.json();
} finally {
  await new Promise((resolve) => server.close(resolve));
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
