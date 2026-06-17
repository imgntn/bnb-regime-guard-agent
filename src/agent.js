import { buildTradeIntent, analyzeSnapshot } from "./strategy.js";
import { loadMarketSnapshot } from "./cmc.js";
import { loadPolicy } from "./config.js";
import { liveModeAllowed, loadState, recordTrade, saveState, validateIntent } from "./guardrails.js";
import { twak } from "./twak.js";

export async function analyze() {
  const policy = loadPolicy();
  const snapshot = await loadMarketSnapshot({ symbols: policy.eligibleSymbols });
  const report = analyzeSnapshot(snapshot, policy);
  const intent = buildTradeIntent(report, policy);
  const validation = validateIntent(intent, report, policy);
  return { report, intent, validation };
}

export async function runOnce({ live = false } = {}) {
  const policy = loadPolicy();
  const snapshot = await loadMarketSnapshot({ symbols: policy.eligibleSymbols });
  const report = analyzeSnapshot(snapshot, policy);
  const intent = buildTradeIntent(report, policy);
  const state = loadState();
  const validation = validateIntent(intent, report, policy, state);

  const result = { mode: live ? "live" : "dry-run", report, intent, validation };
  if (!validation.ok) {
    return { ...result, skipped: true };
  }

  let quote;
  try {
    quote = await twak.quoteSwap(intent);
    result.quote = quote;
  } catch (error) {
    if (!live) {
      return {
        ...result,
        executed: false,
        quoteSkipped: {
          reason: "TWAK quote unavailable until auth and wallet setup are complete.",
          error: error.message,
          code: error.code
        }
      };
    }
    throw error;
  }

  if (!live) {
    return { ...result, executed: false };
  }
  if (!liveModeAllowed()) {
    return {
      ...result,
      executed: false,
      blocked: "Set LIVE_TRADING=1 and TWAK_CONFIRM_LIVE=I_ACCEPT_LIVE_TRADING_RISK to execute swaps."
    };
  }

  const execution = await twak.executeSwap(intent);
  saveState(recordTrade(state, { intent, execution }));
  return { ...result, executed: true, execution };
}

export async function doctor() {
  const checks = {};
  for (const [name, fn] of Object.entries({
    twakAuth: twak.authStatus,
    twakWallet: twak.walletStatus,
    competition: twak.competeStatus
  })) {
    try {
      checks[name] = { ok: true, result: await fn() };
    } catch (error) {
      checks[name] = { ok: false, error: error.message, code: error.code };
    }
  }
  checks.cmc = {
    ok: Boolean(process.env.CMC_API_KEY) || process.env.CMC_USE_X402 === "1",
    mode: process.env.CMC_API_KEY ? "rest" : process.env.CMC_USE_X402 === "1" ? "x402" : "sample-fallback"
  };
  return checks;
}
