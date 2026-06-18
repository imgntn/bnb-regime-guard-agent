import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { ROOT } from "./config.js";

const LEDGER_PATH = path.join(ROOT, "state", "evidence-ledger.jsonl");
const LATEST_PATH = path.join(ROOT, "state", "latest-decision-receipt.json");

export function hashObject(value) {
  return crypto.createHash("sha256").update(stableStringify(value)).digest("hex");
}

export function recordDecisionReceipt({ mode, snapshot, report, routeSelection, intent, validation, quote, execution }) {
  const receipt = {
    schema: "regime-guard.decision-receipt.v1",
    recordedAt: new Date().toISOString(),
    mode,
    agent: {
      name: "Regime Guard TWAK Agent",
      walletAddress: process.env.AGENT_WALLET_ADDRESS ?? null,
      repository: "https://github.com/imgntn/bnb-regime-guard-agent"
    },
    dataAccess: snapshot.agent_hub_access ?? { mode: "unknown" },
    hashes: {
      snapshot: hashObject(stripRuntimeFields(snapshot)),
      policy: hashObject(report.policy),
      report: hashObject(stripRuntimeFields(report)),
      intent: hashObject(intent)
    },
    decision: {
      regime: report.regime,
      selected: routeSelection?.selected ?? routeSelection?.position ?? null,
      routeMode: routeSelection?.mode ?? null,
      intentType: intent.intentType ?? intent.action,
      action: intent.action,
      fromSymbol: intent.fromSymbol ?? null,
      toSymbol: intent.toSymbol ?? null,
      usdAmount: intent.usdAmount ?? null,
      validation
    },
    quote: quote ? summarizeQuote(quote) : null,
    execution: summarizeExecution(execution)
  };
  receipt.decisionId = hashObject(receipt).slice(0, 24);

  fs.mkdirSync(path.dirname(LEDGER_PATH), { recursive: true });
  fs.appendFileSync(LEDGER_PATH, JSON.stringify(receipt) + "\n");
  fs.writeFileSync(LATEST_PATH, JSON.stringify(receipt, null, 2) + "\n");
  return { receipt, ledgerPath: LEDGER_PATH, latestPath: LATEST_PATH };
}

export function latestDecisionReceipt() {
  if (!fs.existsSync(LATEST_PATH)) {
    return { found: false, path: LATEST_PATH };
  }
  return { found: true, path: LATEST_PATH, receipt: JSON.parse(fs.readFileSync(LATEST_PATH, "utf8")) };
}

function summarizeQuote(quote) {
  return {
    input: quote.input,
    output: quote.output,
    minReceived: quote.minReceived,
    provider: quote.provider,
    priceImpact: quote.priceImpact
  };
}

function summarizeExecution(execution) {
  if (!execution) return null;
  return {
    txHash: execution.txHash ?? execution.transactionHash ?? execution.hash ?? null,
    status: execution.status ?? null,
    rawHash: hashObject(execution)
  };
}

function stripRuntimeFields(value) {
  if (!value || typeof value !== "object") return value;
  const copy = JSON.parse(JSON.stringify(value));
  delete copy.generatedAt;
  delete copy.generated_at;
  return copy;
}

function stableStringify(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
}
