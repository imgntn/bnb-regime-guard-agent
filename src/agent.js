import { analyzeSnapshot, buildQualificationIntent, buildTradeIntent, buildTradeIntentForSignal } from "./strategy.js";
import { loadMarketSnapshot } from "./cmc.js";
import { ROOT, loadPolicy } from "./config.js";
import { liveModeAllowed, loadState, recordTrade, saveState, validateIntent } from "./guardrails.js";
import { twak } from "./twak.js";
import { evaluateProfitabilityChecklist } from "./checklist.js";
import { latestDecisionReceipt, recordDecisionReceipt } from "./evidence.js";
import { liveTradingDisclaimerReceipt } from "./disclaimer.js";
import { x402WalletStatus } from "./x402.js";
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
  const state = loadState();
  const routed = await chooseRoutedIntent(report, policy, snapshot, state);
  const intent = routed.intent;
  const validation = validateIntent(intent, report, policy, state);

  const result = { mode: live ? "live" : "dry-run", report, intent, routeSelection: routed.routeSelection, validation };
  if (!validation.ok) {
    const skipped = { ...result, skipped: true };
    return attachReceipt(skipped, snapshot);
  }

  let quote = routed.quote;
  try {
    quote ??= await quoteIntent(intent);
    result.quote = quote;
  } catch (error) {
    if (!live) {
      return {
        ...attachReceipt(result, snapshot),
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
    return attachReceipt({ ...result, executed: false }, snapshot);
  }
  if (!liveModeAllowed()) {
    return attachReceipt({
      ...result,
      executed: false,
      blocked: "Set LIVE_TRADING=1 and TWAK_CONFIRM_LIVE=I_ACCEPT_LIVE_TRADING_RISK to execute swaps.",
      disclaimer: liveTradingDisclaimerReceipt()
    }, snapshot);
  }

  const execution = await executeIntent(intent);
  saveState(applyPositionUpdate(recordTrade(state, { intent, quote, execution }), intent, quote));
  return attachReceipt({ ...result, executed: true, execution, disclaimer: liveTradingDisclaimerReceipt() }, snapshot);
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
  checks.agentHub = {
    ok: Boolean(process.env.CMC_API_KEY) || process.env.CMC_USE_X402 === "1",
    x402Enabled: process.env.CMC_USE_X402 === "1",
    x402Endpoint: process.env.CMC_X402_MCP_URL ?? "https://mcp.coinmarketcap.com/x402/mcp"
  };
  try {
    checks.x402Wallet = { ok: true, result: await x402WalletStatus() };
  } catch (error) {
    checks.x402Wallet = { ok: false, error: error.message, code: error.code };
  }
  checks.evidence = latestDecisionReceipt();
  return checks;
}

export async function x402Status() {
  return x402WalletStatus();
}

export function latestEvidence() {
  return latestDecisionReceipt();
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
  const assets = assetMap(snapshot);
  const candidates = report.signals.filter(
    (signal) => signal.action === "ROTATE_IN" && signal.confidence >= policy.minConfidence
  );

  const scans = [];
  for (const signal of candidates) {
    scans.push(await scanCandidateRoute(signal, policy, {
      asset: assets.get(signal.symbol),
      regime: report.regime
    }));
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

async function chooseRoutedIntent(report, policy, snapshot = { assets: [] }, state = loadState()) {
  const assets = assetMap(snapshot);
  const exit = await maybeBuildExitIntent(state.livePosition, report, policy);
  if (exit) {
    return exit;
  }

  const candidates = report.signals.filter(
    (signal) => signal.action === "ROTATE_IN" && signal.confidence >= policy.minConfidence
  );
  if (!candidates.length) {
    const qualification = await maybeBuildQualificationIntent(report, policy, state);
    if (qualification) return qualification;
    return {
      intent: buildTradeIntent(report, policy),
      routeSelection: { mode: "none", reason: "no ROTATE_IN candidates above confidence threshold" }
    };
  }

  const scans = [];
  for (const signal of candidates) {
    scans.push(await scanCandidateRoute(signal, policy, {
      asset: assets.get(signal.symbol),
      regime: report.regime
    }));
  }
  const executable = scans.filter(
    (scan) => scan.ok && scan.checklist?.status !== "fail" && Math.abs(scan.roundTripPnlPct) <= policy.maxRoundTripDragPct
  );
  if (!executable.length) {
    const qualification = await maybeBuildQualificationIntent(report, policy, state, scans);
    if (qualification) return qualification;
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

async function maybeBuildExitIntent(position, report, policy) {
  if (!position?.open) return null;

  const intent = {
    action: "SWAP_EXACT",
    intentType: "EXIT",
    chain: policy.chain,
    fromSymbol: position.symbol,
    toSymbol: policy.baseStable,
    fromAssetId: position.assetId,
    toAssetId: policy.tokenAddresses?.[policy.baseStable] ?? policy.baseStable,
    amount: position.amount,
    slippagePct: policy.slippagePct,
    rationale: []
  };
  let quote;
  try {
    quote = await quoteIntent(intent);
  } catch (error) {
    return {
      intent: { action: "NO_TRADE", reason: "open position could not be exit-quoted" },
      routeSelection: {
        mode: "position-exit-unavailable",
        position: position.symbol,
        error: error.message,
        code: error.code
      }
    };
  }
  const markOutput = parseQuotedAmount(quote.output);
  const pnl = markOutput.amount - position.entryCost.amount;
  const pnlPct = position.entryCost.amount ? (pnl / position.entryCost.amount) * 100 : 0;
  const ageHours = (Date.now() - Date.parse(position.openedAt)) / 36e5;
  const reasons = [];

  if (report.regime.label === "risk_off") reasons.push("market regime moved risk_off");
  if (pnlPct <= -policy.positionStopLossPct) reasons.push(`position stop loss hit at ${pnlPct.toFixed(2)}%`);
  if (pnlPct >= policy.takeProfitPct) reasons.push(`take profit hit at ${pnlPct.toFixed(2)}%`);
  if (ageHours >= policy.maxPositionHoldHours && pnlPct > 0) {
    reasons.push(`position age ${ageHours.toFixed(1)}h exceeded target horizon with positive PnL`);
  }

  if (!reasons.length) return null;
  return {
    intent: { ...intent, rationale: reasons },
    quote,
    routeSelection: {
      mode: "position-exit",
      position: position.symbol,
      pnlPct: Number(pnlPct.toFixed(4)),
      ageHours: Number(ageHours.toFixed(2)),
      reasons
    }
  };
}

async function maybeBuildQualificationIntent(report, policy, state, failedCandidates = []) {
  const today = new Date().toISOString().slice(0, 10);
  const tradesToday = (state.tradeLog ?? []).filter((trade) => String(trade.at).startsWith(today)).length;
  if (tradesToday >= policy.dailyTradeFloor || report.regime.label === "risk_off") {
    return null;
  }

  const scans = [];
  for (const target of policy.qualificationTargets ?? []) {
    const intent = buildQualificationIntent(policy, target);
    const scan = await scanCandidateRoute(intent.signal, policy, { regime: report.regime, intent });
    scans.push(scan);
  }
  const executable = scans
    .filter((scan) => scan.ok && Math.abs(scan.roundTripPnlPct) <= policy.qualificationMaxRoundTripDragPct)
    .sort((a, b) => Math.abs(a.roundTripPnlPct) - Math.abs(b.roundTripPnlPct));

  if (!executable.length) return null;
  const selected = executable[0];
  return {
    intent: selected.intent,
    quote: selected.entryQuote,
    routeSelection: {
      mode: "qualification-floor",
      reason: "minimum daily competition trade without forcing a high-risk asset entry",
      failedCandidates,
      selected: selected.symbol,
      candidates: scans
    }
  };
}

async function scanCandidateRoute(signal, policy, context = {}) {
  const intent = context.intent ?? buildTradeIntentForSignal(signal, policy);
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
    const route = {
      roundTripPnl: Number(roundTripPnl.toFixed(8)),
      roundTripPnlPct: Number(roundTripPnlPct.toFixed(4))
    };
    const checklist = evaluateProfitabilityChecklist({
      signal,
      asset: context.asset,
      regime: context.regime,
      route,
      policy
    });
    return {
      ok: true,
      symbol: signal.symbol,
      score: signal.score,
      adjustedScore: Number(adjustedScore.toFixed(4)),
      confidence: signal.confidence,
      intent,
      entryQuote,
      exitQuote,
      roundTripPnl: route.roundTripPnl,
      roundTripPnlPct: route.roundTripPnlPct,
      checklist,
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

async function quoteIntent(intent) {
  if (intent.action === "SWAP_EXACT") {
    return twak.quoteExactSwap(intent);
  }
  return twak.quoteSwap(intent);
}

async function executeIntent(intent) {
  if (intent.action === "SWAP_EXACT") {
    return twak.executeExactSwap(intent);
  }
  return twak.executeSwap(intent);
}

function applyPositionUpdate(state, intent, quote) {
  if (intent.intentType === "EXIT") {
    return {
      ...state,
      livePosition: {
        ...state.livePosition,
        open: false,
        closedAt: new Date().toISOString(),
        exitQuote: quote
      }
    };
  }
  if (intent.intentType !== "ROTATE_IN") return state;

  const entryInput = parseQuotedAmount(quote.input);
  const entryOutput = parseQuotedAmount(quote.output);
  return {
    ...state,
    livePosition: {
      open: true,
      openedAt: new Date().toISOString(),
      symbol: intent.toSymbol,
      assetId: intent.toAssetId,
      amount: entryOutput.amount,
      entryCost: entryInput,
      entryQuote: quote,
      signal: intent.signal
    }
  };
}

function assetMap(snapshot) {
  return new Map((snapshot.assets ?? []).map((asset) => [String(asset.symbol).toUpperCase(), asset]));
}

function parseQuotedAmount(text) {
  const match = String(text).match(/^([0-9.]+)\s+(.+)$/);
  if (!match) {
    throw new Error(`Cannot parse quoted amount: ${text}`);
  }
  return { amount: Number(match[1]), symbol: match[2] };
}

function attachReceipt(result, snapshot) {
  const evidence = recordDecisionReceipt({
    mode: result.mode,
    snapshot,
    report: result.report,
    routeSelection: result.routeSelection,
    intent: result.intent,
    validation: result.validation,
    quote: result.quote,
    execution: result.execution,
    disclaimer: result.disclaimer
  });
  return { ...result, evidence: { decisionId: evidence.receipt.decisionId, latestPath: evidence.latestPath, ledgerPath: evidence.ledgerPath } };
}
