import { config } from "dotenv";
import express from "express";
import rateLimit from "express-rate-limit";
import { verify, settle } from "x402/facilitator";
import {
  PaymentRequirementsSchema,
  PaymentPayloadSchema,
} from "x402/types";
import { createPublicClient, createWalletClient, http, publicActions } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { seiTestnet } from "viem/chains";

config();

const PRIVATE_KEY = process.env.PRIVATE_KEY;

if (!PRIVATE_KEY) {
  console.error("Missing required environment variables");
  process.exit(1);
}

// Optional shared-secret auth for /verify and /settle. Set FACILITATOR_API_KEY
// in this app's .env (and the backend's) to require it; unset = open, same as before.
const FACILITATOR_API_KEY = process.env.FACILITATOR_API_KEY;
if (!FACILITATOR_API_KEY) {
  console.warn("⚠️  FACILITATOR_API_KEY not set — /verify and /settle accept unauthenticated requests.");
}

const requireApiKey = (req, res, next) => {
  if (!FACILITATOR_API_KEY) return next();
  const provided = (req.headers["authorization"] || "").replace(/^Bearer\s+/i, "");
  if (provided !== FACILITATOR_API_KEY) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
};

// Settlement moves real funds and verification is compute-heavy; cap abuse either way.
const settlementLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests, please try again later" },
});

const app = express();
app.use(express.json());

// Basic request logger
app.use((req, _res, next) => {
  try {
    console.log("[REQ]", req.method, req.originalUrl);
    // Bodies contain payment payloads and signatures — keep them out of production logs.
    if (process.env.NODE_ENV !== "production" && req.body && Object.keys(req.body).length) {
      console.log("[REQ BODY]", JSON.stringify(req.body));
    }
  } catch (e) {
    console.error("[REQ LOG ERROR]", e);
  } finally {
    next();
  }
});

const client = createPublicClient({
  chain: seiTestnet,
  transport: http(),
}).extend(publicActions);

// Verification endpoint
app.post("/verify", settlementLimiter, requireApiKey, async (req, res) => {
  try {
    console.log("[VERIFY] Start");
    const body = req.body;
    const paymentRequirements = PaymentRequirementsSchema.parse(
      body.paymentRequirements
    );
    const paymentPayload = PaymentPayloadSchema.parse(body.paymentPayload);
    console.log("[VERIFY] Parsed requirements", JSON.stringify(paymentRequirements));
    console.log("[VERIFY] Parsed payload", JSON.stringify(paymentPayload));
    const valid = await verify(client, paymentPayload, paymentRequirements);
    console.log("[VERIFY] Result", JSON.stringify(valid));
    res.json(valid);
  } catch (error) {
    console.error("[VERIFY] Error", error);
    res.status(400).json({
      isValid: false,
      invalidReason: "verify_error",
      error: error?.message || String(error),
    });
  }
});

// Settlement endpoint
app.post("/settle", settlementLimiter, requireApiKey, async (req, res) => {
  try {
    console.log("[SETTLE] Start");

          const signer = createWalletClient({
        chain: seiTestnet,
        transport: http(),
        account: privateKeyToAccount(PRIVATE_KEY),
      }).extend(publicActions);
    console.log("[SETTLE] Wallet client created");
    const body = req.body;
    const paymentRequirements = PaymentRequirementsSchema.parse(
      body.paymentRequirements
    );
    const paymentPayload = PaymentPayloadSchema.parse(body.paymentPayload);
    console.log("[SETTLE] Parsed requirements", JSON.stringify(paymentRequirements));
    console.log("[SETTLE] Parsed payload", JSON.stringify(paymentPayload));
    const response = await settle(signer, paymentPayload, paymentRequirements);
    console.log("[SETTLE] Response", JSON.stringify(response));
    res.json(response);
  } catch (error) {
    console.error("[SETTLE] Error", error);
    res.status(400).json({
      success: false,
      errorReason: "settle_error",
      error: error?.message || String(error),
    });
  }
});

// Supported schemes endpoint
app.get("/supported", (req, res) => {
  console.log("[SUPPORTED] Query");
  res.json({
    kinds: [
      {
        x402Version: 1,
        scheme: "exact",
        network: "sei-testnet",
      },
    ],
  });
});

app.listen(process.env.PORT || 3002, () => {
  console.log(
    `Server listening at http://localhost:${process.env.PORT || 3002}`
  );
});