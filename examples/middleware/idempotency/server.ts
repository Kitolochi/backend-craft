import express from "express";
import { idempotencyMiddleware, IdempotencyStore } from "./idempotency.js";

const app = express();
const PORT = Number(process.env.PORT) || 3000;

app.use(express.json());

const store = new IdempotencyStore();

// Apply idempotency to mutation endpoints
app.post("/payments", idempotencyMiddleware(store), async (req, res) => {
  const { amount, currency, recipient } = req.body;

  // Simulate payment processing with random delay
  await new Promise((r) => setTimeout(r, 200 + Math.random() * 300));

  // Simulate occasional failures
  if (Math.random() < 0.1) {
    res.status(500).json({ error: "Payment processor temporarily unavailable" });
    return;
  }

  const payment = {
    id: `pay_${Date.now().toString(36)}`,
    amount,
    currency: currency ?? "USD",
    recipient,
    status: "completed",
    processedAt: new Date().toISOString(),
  };

  console.log(`[payment] Processed: ${payment.id} — $${amount} to ${recipient}`);
  res.status(201).json(payment);
});

app.post("/orders", idempotencyMiddleware(store), async (req, res) => {
  const { items, shippingAddress } = req.body;

  await new Promise((r) => setTimeout(r, 100));

  const order = {
    id: `ord_${Date.now().toString(36)}`,
    items,
    shippingAddress,
    status: "confirmed",
    createdAt: new Date().toISOString(),
  };

  res.status(201).json(order);
});

// Read endpoints don't need idempotency
app.get("/payments/:id", (req, res) => {
  res.json({ id: req.params.id, status: "completed" });
});

app.get("/idempotency/stats", (_req, res) => {
  res.json(store.stats());
});

app.listen(PORT, () => {
  console.log(`Idempotency demo on http://localhost:${PORT}`);
  console.log("\nTest idempotency:");
  console.log("  KEY=$(uuidgen)");
  console.log("  curl -X POST -H 'Idempotency-Key: $KEY' -H 'Content-Type: application/json' \\");
  console.log("    -d '{\"amount\": 50, \"recipient\": \"alice\"}' localhost:3000/payments");
  console.log("  # Repeat same curl — should return identical response");
});
