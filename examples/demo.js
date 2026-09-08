import http from "node:http";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { recordCustomEvent, recordDatabaseQuery, trace } from "@codeflow/core";

const regressionMode = process.env.CODEFLOW_DEMO_REGRESSION === "1";
const sourceFile = fileURLToPath(import.meta.url);

async function main() {
  const api = await startDemoApi();
  try {
    await trace("DemoExecution", async () => {
      const user = await login("pat@example.test", "not-recorded");
      const products = await searchProducts("keyboard");
      const cart = await addToCart(user.id, products.slice(0, 2));
      await applyPromoCode(cart, "SUMMER-EXPIRED");
      await checkout(user, cart, api.baseUrl);
    });
  } finally {
    await api.close();
  }
}

async function login(email, _password) {
  return trace("AuthService.login", async () => {
    recordCustomEvent("login-attempt", { emailDomain: email.split("@")[1], passwordCaptured: false });
    await delay(24);
    return { id: "user_123", email };
  });
}

async function searchProducts(query) {
  return trace("ProductSearch.search", async () => {
    const template = fs.readFileSync(sourceFile, "utf8");
    recordCustomEvent("search-template-loaded", { bytes: template.length });
    await recordDatabaseQuery("ProductIndex.query", async () => {
      await delay(regressionMode ? 38 : 20);
      return true;
    }, { query, parametersCaptured: false });

    await trace("ProductSearch.rankResults", async () => {
      await delay(regressionMode ? 42 : 16);
    });

    return [
      { sku: "kbd-pro", name: "CodeBoard Pro", price: 159 },
      { sku: "switch-kit", name: "Tactile switch kit", price: 39 },
      { sku: "deskmat", name: "Build trace deskmat", price: 29 }
    ];
  });
}

async function addToCart(userId, products) {
  return trace("CartService.addItems", async () => {
    const cart = { id: "cart_456", userId, items: [] };
    for (const product of products) {
      await trace("CartService.addItem", async () => {
        await delay(7);
        cart.items.push({ sku: product.sku, quantity: 1, price: product.price });
      }, { metadata: { sku: product.sku } });
    }
    return cart;
  });
}

async function applyPromoCode(cart, code) {
  return trace("PromoService.apply", async () => {
    try {
      await trace("PromoService.validateCode", async () => {
        await delay(12);
        throw new Error(`Promo code expired: ${code}`);
      });
    } catch (error) {
      recordCustomEvent("promo-skipped", {
        cartId: cart.id,
        reason: error instanceof Error ? error.message : String(error)
      });
    }
  });
}

async function checkout(user, cart, apiBaseUrl) {
  return trace("CheckoutController.checkout", async () => {
    await trace("CheckoutController.validateCart", async () => {
      await delay(10);
      if (cart.items.length === 0) {
        throw new Error("Cart is empty");
      }
    });

    await reserveInventory(cart.items);
    const payment = await chargePayment(user, cart, apiBaseUrl);
    const shipping = await quoteShipping(cart, apiBaseUrl);
    await trace("OrderService.persistOrder", async () => {
      await recordDatabaseQuery("OrderRepository.insert", async () => {
        await delay(regressionMode ? 45 : 18);
        return true;
      }, { rows: 1 });
    });

    console.info("checkout-complete", { orderId: "order_789", paymentStatus: payment.status, shipping });
  });
}

async function reserveInventory(items) {
  return trace("InventoryService.reserve", async () => {
    const lookupCount = regressionMode ? 19 : 7;
    for (let index = 0; index < lookupCount; index += 1) {
      await recordDatabaseQuery("InventoryRepository.lookup", async () => {
        await delay(regressionMode ? 11 : 6);
        return items[index % items.length]?.sku;
      }, { attempt: index + 1 });
    }
  }, { metadata: { regressionMode } });
}

async function chargePayment(user, cart, apiBaseUrl) {
  return trace("PaymentService.charge", async () => {
    const total = cart.items.reduce((sum, item) => sum + item.price * item.quantity, 0);
    const response = await fetch(`${apiBaseUrl}/payment?access_token=demo-secret`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer demo-secret"
      },
      body: JSON.stringify({
        userId: user.id,
        total
      })
    });

    if (!response.ok) {
      throw new Error(`Payment failed with HTTP ${response.status}`);
    }

    return await response.json();
  }, { metadata: { provider: "demo-pay", requestBodyCaptured: false } });
}

async function quoteShipping(cart, apiBaseUrl) {
  return trace("ShippingService.quote", async () => {
    const response = await fetch(`${apiBaseUrl}/shipping?cart=${cart.id}`);
    return await response.json();
  });
}

function startDemoApi() {
  const server = http.createServer(async (request, response) => {
    if (!request.url) {
      response.writeHead(404);
      response.end();
      return;
    }

    if (request.url.startsWith("/payment")) {
      await delay(regressionMode ? 260 : 95);
      response.writeHead(200, { "content-type": "application/json", "set-cookie": "session=secret" });
      response.end(JSON.stringify({ status: "authorized", id: "pay_123" }));
      return;
    }

    if (request.url.startsWith("/shipping")) {
      await delay(regressionMode ? 80 : 32);
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ carrier: "LocalShip", cost: 8 }));
      return;
    }

    response.writeHead(404);
    response.end();
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Could not bind demo API"));
        return;
      }
      resolve({
        baseUrl: `http://127.0.0.1:${address.port}`,
        close: () => new Promise((done) => server.close(done))
      });
    });
  });
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
