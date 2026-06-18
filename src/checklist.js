export function evaluateProfitabilityChecklist({ signal, asset, regime, route, policy }) {
  const checklist = policy.profitabilityChecklist ?? {};
  const failures = [];
  const warnings = [];
  const passes = [];

  check(
    regime.score >= checklist.minRegimeScore,
    "market regime is risk-on",
    `regime score ${regime.score} is below ${checklist.minRegimeScore}`,
    { passes, warnings, failures }
  );

  const rsi = Number(asset?.rsi_14 ?? 50);
  if (rsi > checklist.hardRsiMax) {
    failures.push(`RSI ${rsi} is overheated above hard cap ${checklist.hardRsiMax}`);
  } else if (rsi < checklist.idealRsiMin || rsi > checklist.idealRsiMax) {
    warnings.push(`RSI ${rsi} is outside ideal ${checklist.idealRsiMin}-${checklist.idealRsiMax}`);
  } else {
    passes.push(`RSI ${rsi} is in the ideal trend band`);
  }

  const change24h = Number(asset?.change_24h_pct ?? 0);
  if (Math.abs(change24h) > checklist.maxChange24hPct) {
    warnings.push(`24h move ${change24h.toFixed(2)}% is near chase territory`);
  } else {
    passes.push(`24h move ${change24h.toFixed(2)}% is not overextended`);
  }

  const change7d = Number(asset?.change_7d_pct ?? 0);
  if (change7d > checklist.maxChange7dPct) {
    warnings.push(`7d move ${change7d.toFixed(2)}% is extended`);
  } else {
    passes.push(`7d move ${change7d.toFixed(2)}% is within trend-following limit`);
  }

  const funding = Number(asset?.funding_rate_pct ?? 0);
  if (funding > checklist.maxFundingRatePct) {
    failures.push(`funding ${funding.toFixed(4)}% is crowded long`);
  } else {
    passes.push(`funding ${funding.toFixed(4)}% is not crowded`);
  }

  const atr = Number(asset?.atr_pct ?? 0);
  if (atr > checklist.maxAtrPct) {
    warnings.push(`ATR ${atr.toFixed(2)}% is high`);
  } else {
    passes.push(`ATR ${atr.toFixed(2)}% is acceptable`);
  }

  const liquidity = Number(asset?.bnb_chain_liquidity_score ?? 0);
  if (liquidity < checklist.minLiquidityScore) {
    failures.push(`liquidity score ${liquidity} is below ${checklist.minLiquidityScore}`);
  } else {
    passes.push(`liquidity score ${liquidity} is acceptable`);
  }

  const routeDrag = Math.abs(Number(route?.roundTripPnlPct ?? Infinity));
  if (routeDrag > checklist.hardRoundTripDragPct) {
    failures.push(`route drag ${routeDrag.toFixed(4)}% exceeds hard cap ${checklist.hardRoundTripDragPct}%`);
  } else if (routeDrag > checklist.idealRoundTripDragPct) {
    warnings.push(`route drag ${routeDrag.toFixed(4)}% is above ideal ${checklist.idealRoundTripDragPct}%`);
  } else {
    passes.push(`route drag ${routeDrag.toFixed(4)}% is within ideal limit`);
  }

  if (signal.action !== "ROTATE_IN") {
    failures.push(`signal action is ${signal.action}, not ROTATE_IN`);
  }

  let status = "pass";
  if (failures.length) {
    status = "fail";
  } else if (warnings.length > (checklist.closeCallMaxWarnings ?? 2)) {
    status = "fail";
  } else if (warnings.length) {
    status = "close_call";
  }

  return {
    status,
    passes,
    warnings,
    failures
  };
}

function check(condition, passText, failText, result) {
  if (condition) {
    result.passes.push(passText);
  } else {
    result.failures.push(failText);
  }
}
