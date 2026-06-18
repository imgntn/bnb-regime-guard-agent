#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
loadDotEnv();
const policy = readJson("config/risk-policy.json");
const pkg = readJson("package.json");
const outputPath = path.join(ROOT, "docs", "agent-card.json");

const card = {
  schema: "regime-guard.agent-card.v1",
  name: "Regime Guard TWAK Agent",
  version: pkg.version,
  description: "Self-custody BNB Chain trading agent using CoinMarketCap Agent Hub data, route-aware TWAK execution, and auditable decision receipts.",
  repository: "https://github.com/imgntn/bnb-regime-guard-agent",
  track: "BNB Hack Track 1: Autonomous Trading Agents",
  chain: "bsc",
  walletAddress: process.env.AGENT_WALLET_ADDRESS || "set after twak wallet status",
  competitionRegistry: "0x212c61b9b72c95d95bf29cf032f5e5635629aed5",
  data: {
    primary: "CoinMarketCap AI Agent Hub x402 quotes",
    fallback: "CoinMarketCap REST or reproducible sample snapshot",
    x402Endpoint: process.env.CMC_X402_QUOTES_URL || "https://pro-api.coinmarketcap.com/x402/v3/cryptocurrency/quotes/latest",
    x402McpEndpoint: process.env.CMC_X402_MCP_URL || "https://mcp.coinmarketcap.com/x402/mcp"
  },
  execution: {
    layer: "Trust Wallet Agent Kit",
    surfaces: ["auth status", "wallet status", "compete register", "swap quote-only", "swap execute", "exact-amount exit swap"],
    custody: "local self-custody signing"
  },
  bnbAgentSdk: {
    identity: "ERC-8004 agent registration",
    agentUriSource: "docs/agent-card.json",
    registrationScript: "scripts/register-bnb-agent.py"
  },
  evidence: {
    receiptSchema: "regime-guard.decision-receipt.v1",
    localLedger: "state/evidence-ledger.jsonl",
    latestReceipt: "state/latest-decision-receipt.json",
    fields: ["dataAccess", "hashes", "decision", "quote", "execution"]
  },
  guardrails: {
    eligibleSymbols: policy.eligibleSymbols,
    maxUsdPerTrade: policy.maxUsdPerTrade,
    competitionMaxUsdPerTrade: policy.competitionMaxUsdPerTrade,
    maxDailyTrades: policy.maxDailyTrades,
    dailyTradeFloor: policy.dailyTradeFloor,
    slippagePct: policy.slippagePct,
    positionStopLossPct: policy.positionStopLossPct,
    takeProfitPct: policy.takeProfitPct,
    maxPositionHoldHours: policy.maxPositionHoldHours
  }
};

card.policyHash = sha256(stableStringify(card.guardrails));
card.cardHash = sha256(stableStringify({ ...card, cardHash: undefined }));

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, JSON.stringify(card, null, 2) + "\n");
process.stdout.write(JSON.stringify({ wrote: outputPath, cardHash: card.cardHash, policyHash: card.policyHash }, null, 2) + "\n");

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, relativePath), "utf8"));
}

function loadDotEnv() {
  const envPath = path.join(ROOT, ".env");
  if (!fs.existsSync(envPath)) return;
  const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const equals = trimmed.indexOf("=");
    if (equals === -1) continue;
    const key = trimmed.slice(0, equals).trim();
    let value = trimmed.slice(equals + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

function sha256(text) {
  return crypto.createHash("sha256").update(text).digest("hex");
}

function stableStringify(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  return `{${Object.keys(value).sort().filter((key) => value[key] !== undefined).map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
}
