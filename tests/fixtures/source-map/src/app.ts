import { trace } from "@codeflow/core";

async function runCheckout(): Promise<string> {
  return trace("TypeScriptCheckout.run", async () => {
    await delay(8);
    return "ok";
  });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

await runCheckout();
