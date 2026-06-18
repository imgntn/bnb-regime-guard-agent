import { analyzeSnapshot, buildTradeIntent, buildTradeIntentForSignal } from "./strategy.js";
import { loadMarketSnapshot } from "./cmc.js";
import { ROOT, loadPolicy } from "./config.js";
import { liveModeAllowed, loadState, recordTrade, saveState, validateIntent } from "./guardrails.js";
import { twak } from "./twak.js";
import fs from "node:fs";
import path from "node:path";

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
  const routed = await chooseRoutedIntent(report, policy);
  const intent = routed.intent;
  const state = loadState();
  const validation = validateIntent(intent, report, policy, state);

  const result = { mode: live ? "live" : "dry-run", report, intent, routeSelection: routed.routeSelection, validation };
  if (!validation.ok) {
    return { ...result, skipped: true };
  }

  let quote = routed.quote;
  try {
    quote ??= await twak.quoteSwap(intent);
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
    scans.push(await scanCandidateRoute(signal, policy));
  }

  scans.sort((a, b) => (b.adjustedScore ?? -Infinity) - (a.adjustedScore ?? -Infinity));
  return {
    scannedAt: new Date().toISOString(),
    regime: report.regime,
    candidates: scans
  };
}

export async function recordShadowTick() {
  const [mark, scan] = await Promise.allSettled([
    markShadowTrade(),
    scanShadowCandidates()
  ]);
  const entry = {
    recordedAt: new Date().toISOString(),
    mark: mark.status === "fulfilled" ? mark.value : { error: mark.reason?.message ?? String(mark.reason) },
    scan: scan.status === "fulfilled" ? scan.value : { error: scan.reason?.message ?? String(scan.reason) }
  };
  const logPath = path.join(ROOT, "state", "shadow-monitor.jsonl");
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  fs.appendFileSync(logPath, JSON.stringify(entry) + "\n");
  return { ...entry, logPath };
}

export async function runShadowMonitor({ intervalMs = 15 * 60 * 1000 } = {}) {
  do {
    const tick = await recordShadowTick();
    process.stdout.write(JSON.stringify(tick, null, 2) + "\n");
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  } while (true);
}

async function chooseRoutedIntent(report, policy) {
  const candidates = report.signals.filter(
    (signal) => signal.action === "ROTATE_IN" && signal.confidence >= policy.minConfidence
  );
  if (!candidates.length) {
    return {
      intent: buildTradeIntent(report, policy),
      routeSelection: { mode: "none", reason: "no ROTATE_IN candidates above confidence threshold" }
    };
  }

  const scans = [];
  for (const signal of candidates) {
    scans.push(await scanCandidateRoute(signal, policy));
  }
  const executable = scans.filter(
    (scan) => scan.ok && Math.abs(scan.roundTripPnlPct) <= policy.maxRoundTripDragPct
  );
  if (!executable.length) {
    return {
      intent: { action: "NO_TRADE", reason: "no candidate passed route-drag guardrail" },
      routeSelection: { mode: "route-adjusted", candidates: scans }
    };
  }

  executable.sort((a, b) => b.adjustedScore - a.adjustedScore);
  const selected = executable[0];
  return {
    intent: selected.intent,
    quote: selected.entryQuote,
    routeSelection: { mode: "route-adjusted", selected: selected.symbol, candidates: scans }
  };
}

async function scanCandidateRoute(signal, policy) {
  const intent = buildTradeIntentForSignal(signal, policy);
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
    const routeDrag = Math.abs(roundTripPnlPct);
    const adjustedScore = signal.score - routeDrag * policy.routeDragScorePenaltyMultiplier;
    return {
      ok: true,
      symbol: signal.symbol,
      score: signal.score,
      adjustedScore: Number(adjustedScore.toFixed(4)),
      confidence: signal.confidence,
      intent,
      entryQuote,
      exitQuote,
      roundTripPnl: Number(roundTripPnl.toFixed(8)),
      roundTripPnlPct: Number(roundTripPnlPct.toFixed(4)),
      routeAccepted: routeDrag <= policy.maxRoundTripDragPct
    };
  } catch (error) {
    return {
      ok: false,
      symbol: signal.symbol,
      score: signal.score,
      confidence: signal.confidence,
      error: error.message,
      code: error.code
    };
  }
}

function parseQuotedAmount(text) {
  const match = String(text).match(/^([0-9.]+)\s+(.+)$/);
  if (!match) {
    throw new Error(`Cannot parse quoted amount: ${text}`);
  }
  return { amount: Number(match[1]), symbol: match[2] };
}
