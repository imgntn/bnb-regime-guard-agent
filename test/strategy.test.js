import assert from "node:assert/strict";
import test from "node:test";
import { validateIntent } from "../src/guardrails.js";
import { analyzeSnapshot, buildQualificationIntent, buildTradeIntent, buildTradeIntentForSignal } from "../src/strategy.js";
import { evaluateProfitabilityChecklist } from "../src/checklist.js";
import { readJson } from "../src/config.js";

const policy = readJson("config/risk-policy.json");

test("sample snapshot produces a guarded swap intent", () => {
  const snapshot = readJson("data/sample-market-snapshot.json");
  const report = analyzeSnapshot(snapshot, policy);
  const intent = buildTradeIntent(report, policy);
  assert.equal(report.regime.label, "risk_on");
  assert.equal(intent.action, "SWAP");
  assert.equal(intent.chain, "bsc");
  assert.equal(intent.fromSymbol, "USDT");
  assert.ok(policy.eligibleSymbols.includes(intent.toSymbol));
  assert.match(intent.fromAssetId, /^0x[a-fA-F0-9]{40}$/);
  assert.match(intent.toAssetId, /^0x[a-fA-F0-9]{40}$/);
});

test("trade intents can be built for any allowlisted token with a configured address", () => {
  const signal = {
    symbol: "FLOKI",
    action: "ROTATE_IN",
    score: 55,
    confidence: 80,
    reasons: ["test"]
  };
  const intent = buildTradeIntentForSignal(signal, policy);
  assert.equal(intent.toSymbol, "FLOKI");
  assert.equal(intent.toAssetId, policy.tokenAddresses.FLOKI);
});

test("qualification intent is a small eligible stable-to-stable swap", () => {
  const intent = buildQualificationIntent(policy, "USDC");
  assert.equal(intent.action, "SWAP");
  assert.equal(intent.intentType, "QUALIFICATION");
  assert.equal(intent.fromSymbol, "USDT");
  assert.equal(intent.toSymbol, "USDC");
  assert.equal(intent.usdAmount, policy.qualificationTradeUsd);
  assert.ok(policy.eligibleSymbols.includes(intent.fromSymbol));
  assert.ok(policy.eligibleSymbols.includes(intent.toSymbol));
});

test("exact exit intents are allowed in risk-off regimes", () => {
  const snapshot = readJson("data/sample-market-snapshot.json");
  snapshot.market.fear_greed = 20;
  snapshot.market.btc_24h_change_pct = -4;
  snapshot.market.global_market_cap_24h_change_pct = -3;
  snapshot.market.stablecoin_dominance_change_pct = 2;
  const report = analyzeSnapshot(snapshot, policy);
  const validation = validateIntent({
    action: "SWAP_EXACT",
    intentType: "EXIT",
    chain: "bsc",
    fromSymbol: "CAKE",
    toSymbol: "USDT",
    amount: 1,
    slippagePct: policy.slippagePct
  }, report, policy, { tradeLog: [] });

  assert.equal(report.regime.label, "risk_off");
  assert.equal(validation.ok, true);
});

test("risk-off report blocks new rotate-in intent through validation inputs", () => {
  const snapshot = readJson("data/sample-market-snapshot.json");
  snapshot.market.fear_greed = 20;
  snapshot.market.btc_24h_change_pct = -4;
  snapshot.market.global_market_cap_24h_change_pct = -3;
  snapshot.market.stablecoin_dominance_change_pct = 2;
  const report = analyzeSnapshot(snapshot, policy);
  assert.equal(report.regime.label, "risk_off");
});

test("profitability checklist flags close calls and hard failures", () => {
  const signal = { symbol: "CAKE", action: "ROTATE_IN" };
  const asset = {
    symbol: "CAKE",
    rsi_14: 69,
    change_24h_pct: 5,
    change_7d_pct: 11,
    funding_rate_pct: 0.02,
    atr_pct: 8,
    bnb_chain_liquidity_score: 84
  };
  const close = evaluateProfitabilityChecklist({
    signal,
    asset,
    regime: { score: 21.3 },
    route: { roundTripPnlPct: -1.4 },
    policy
  });
  assert.equal(close.status, "close_call");
  assert.ok(close.warnings.length > 0);

  const fail = evaluateProfitabilityChecklist({
    signal,
    asset: { ...asset, rsi_14: 84, funding_rate_pct: 0.12 },
    regime: { score: 10 },
    route: { roundTripPnlPct: -2.1 },
    policy
  });
  assert.equal(fail.status, "fail");
  assert.ok(fail.failures.length >= 3);
});
