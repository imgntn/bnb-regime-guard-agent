import fs from "node:fs";
import path from "node:path";
import { ROOT } from "./config.js";

const statePath = path.join(ROOT, "state", "agent-state.json");

export function loadState() {
  if (!fs.existsSync(statePath)) {
    return { tradeLog: [], equityHighWatermark: null, livePosition: null };
  }
  return {
    tradeLog: [],
    equityHighWatermark: null,
    livePosition: null,
    ...JSON.parse(fs.readFileSync(statePath, "utf8"))
  };
}

export function saveState(state) {
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2) + "\n");
}

export function validateIntent(intent, report, policy, state = loadState()) {
  const today = new Date().toISOString().slice(0, 10);
  const tradesToday = state.tradeLog.filter((trade) => String(trade.at).startsWith(today)).length;
  const failures = [];

  if (!["SWAP", "SWAP_EXACT"].includes(intent.action)) {
    failures.push(intent.reason ?? "no swap intent");
  }
  if (tradesToday >= policy.maxDailyTrades) {
    failures.push(`daily trade cap reached (${policy.maxDailyTrades})`);
  }
  if (intent.usdAmount && intent.usdAmount > policy.maxUsdPerTrade) {
    failures.push(`trade size ${intent.usdAmount} exceeds max ${policy.maxUsdPerTrade}`);
  }
  if (report.regime.label === "risk_off" && intent.intentType !== "EXIT") {
    failures.push("risk_off regime blocks new rotate-in trades");
  }
  for (const symbol of [intent.fromSymbol, intent.toSymbol].filter(Boolean)) {
    if (!policy.eligibleSymbols.includes(symbol)) {
      failures.push(`${symbol} is outside agent allowlist`);
    }
  }

  return { ok: failures.length === 0, failures, tradesToday };
}

export function recordTrade(state, trade) {
  return {
    ...state,
    tradeLog: [...state.tradeLog, { at: new Date().toISOString(), ...trade }]
  };
}

export function liveModeAllowed() {
  return process.env.LIVE_TRADING === "1" && process.env.TWAK_CONFIRM_LIVE === "I_ACCEPT_LIVE_TRADING_RISK";
}
