import assert from "node:assert/strict";
import test from "node:test";
import { analyzeSnapshot, buildTradeIntent } from "../src/strategy.js";
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

test("risk-off report blocks new rotate-in intent through validation inputs", () => {
  const snapshot = readJson("data/sample-market-snapshot.json");
  snapshot.market.fear_greed = 20;
  snapshot.market.btc_24h_change_pct = -4;
  snapshot.market.global_market_cap_24h_change_pct = -3;
  snapshot.market.stablecoin_dominance_change_pct = 2;
  const report = analyzeSnapshot(snapshot, policy);
  assert.equal(report.regime.label, "risk_off");
});
