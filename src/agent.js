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

export async function openShadowTrade() {
  const policy = loadPolicy();
  const state = loadState();
  if (state.shadowPosition?.open) {
    return { skipped: true, reason: "shadow position already open", shadowPosition: state.shadowPosition };
  }

  const run = await runOnce({ live: false });
  if (!run.quote) {
    return { skipped: true, reason: "no executable quote available", run };
  }

  const position = {
    open: true,
    openedAt: new Date().toISOString(),
    intent: run.intent,
    entryQuote: run.quote,
    entryInput: parseQuotedAmount(run.quote.input),
    entryOutput: parseQuotedAmount(run.quote.output)
  };

  saveState({ ...state, shadowPosition: position });
  return { opened: true, shadowPosition: position, policy };
}

export async function markShadowTrade() {
  const policy = loadPolicy();
  const state = loadState();
  const position = state.shadowPosition;
  if (!position?.open) {
    return { skipped: true, reason: "no open shadow position" };
  }

  const markQuote = await twak.quoteExactSwap({
    amount: position.entryOutput.amount,
    fromSymbol: position.intent.toSymbol,
    toSymbol: position.intent.fromSymbol,
    fromAssetId: position.intent.toAssetId,
    toAssetId: position.intent.fromAssetId,
    chain: policy.chain,
    slippagePct: policy.slippagePct
  });
  const markOutput = parseQuotedAmount(markQuote.output);
  const entryCost = position.entryInput.amount;
  const pnl = markOutput.amount - entryCost;
  const pnlPct = entryCost ? (pnl / entryCost) * 100 : 0;

  return {
    openedAt: position.openedAt,
    markedAt: new Date().toISOString(),
    asset: position.intent.toSymbol,
    entryCost: position.entryInput,
    positionSize: position.entryOutput,
    markQuote,
    markOutput,
    unrealizedPnl: Number(pnl.toFixed(8)),
    unrealizedPnlPct: Number(pnlPct.toFixed(4))
  };
}

export async function scanShadowCandidates() {
  const policy = loadPolicy();
  const snapshot = await loadMarketSnapshot({ symbols: policy.eligibleSymbols });
  const report = analyzeSnapshot(snapshot, policy);
  const candidates = report.signals.filter(
    (signal) => signal.action === "ROTATE_IN" && signal.confidence >= policy.minConfidence
  );

  const scans = [];
  for (const signal of candidates) {
    const intent = {
      action: "SWAP",
      chain: policy.chain,
      fromSymbol: policy.baseStable,
      toSymbol: signal.symbol,
      fromAssetId: policy.tokenAddresses?.[policy.baseStable] ?? policy.baseStable,
      toAssetId: policy.tokenAddresses?.[signal.symbol] ?? signal.symbol,
      usdAmount: policy.maxUsdPerTrade,
      slippagePct: policy.slippagePct,
      signal
    };
    try {
      const entryQuote = await twak.quoteSwap(intent);
      const entryInput = parseQuotedAmount(entryQuote.input);
      const entryOutput = parseQuotedAmount(entryQuote.output);
      const exitQuote = await twak.quoteExactSwap({
        amount: entryOutput.amount,
        fromSymbol: intent.toSymbol,
        toSymbol: intent.fromSymbol,
        fromAssetId: intent.toAssetId,
        toAssetId: intent.fromAssetId,
        chain: policy.chain,
        slippagePct: policy.slippagePct
      });
      const exitOutput = parseQuotedAmount(exitQuote.output);
      const roundTripPnl = exitOutput.amount - entryInput.amount;
      const roundTripPnlPct = entryInput.amount ? (roundTripPnl / entryInput.amount) * 100 : 0;
      scans.push({
        symbol: signal.symbol,
        score: signal.score,
        confidence: signal.confidence,
        entryQuote,
        exitQuote,
        roundTripPnl: Number(roundTripPnl.toFixed(8)),
        roundTripPnlPct: Number(roundTripPnlPct.toFixed(4))
      });
    } catch (error) {
      scans.push({
        symbol: signal.symbol,
        score: signal.score,
        confidence: signal.confidence,
        error: error.message,
        code: error.code
      });
    }
  }

  scans.sort((a, b) => (b.roundTripPnlPct ?? -Infinity) - (a.roundTripPnlPct ?? -Infinity));
  return {
    scannedAt: new Date().toISOString(),
    regime: report.regime,
    candidates: scans
  };
}

function parseQuotedAmount(text) {
  const match = String(text).match(/^([0-9.]+)\s+(.+)$/);
  if (!match) {
    throw new Error(`Cannot parse quoted amount: ${text}`);
  }
  return { amount: Number(match[1]), symbol: match[2] };
}
