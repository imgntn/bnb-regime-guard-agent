const clamp = (value, low, high) => Math.max(low, Math.min(high, value));

export function marketRegime(snapshot) {
  const market = snapshot.market ?? {};
  const fearGreed = Number(market.fear_greed ?? 50);
  const btc24h = Number(market.btc_24h_change_pct ?? 0);
  const global24h = Number(market.global_market_cap_24h_change_pct ?? 0);
  const stableDominance = Number(market.stablecoin_dominance_change_pct ?? 0);

  let score = 0;
  score += clamp((fearGreed - 50) / 2, -20, 20);
  score += clamp(btc24h * 3, -18, 18);
  score += clamp(global24h * 3, -18, 18);
  score -= clamp(stableDominance * 4, -12, 12);

  return {
    label: score >= 18 ? "risk_on" : score <= -18 ? "risk_off" : "mixed",
    score: Number(score.toFixed(2)),
    fear_greed: Math.round(fearGreed)
  };
}

export function scoreAsset(asset, regimeLabel, policy) {
  const symbol = String(asset.symbol).toUpperCase();
  const reasons = [];

  if (!policy.eligibleSymbols.includes(symbol) && asset.eligible !== true) {
    return { symbol, action: "AVOID", score: -100, confidence: 0, targetWeightPct: 0, reasons: ["outside agent allowlist"] };
  }

  let score = 0;
  let risk = 0;
  const price = Number(asset.price ?? 0);
  const ema20 = Number(asset.ema_20 ?? price);
  const ema50 = Number(asset.ema_50 ?? price);
  const change7d = Number(asset.change_7d_pct ?? asset.quote?.USD?.percent_change_7d ?? 0);
  const rsi = Number(asset.rsi_14 ?? 50);
  const macd = Number(asset.macd_histogram ?? 0);
  const funding = Number(asset.funding_rate_pct ?? 0);
  const oiChange = Number(asset.open_interest_change_pct ?? 0);
  const sentiment = Number(asset.news_sentiment ?? 0);
  const social = Number(asset.social_dominance_change_pct ?? 0);
  const atr = Number(asset.atr_pct ?? 6);
  const volume = Number(asset.volume_24h ?? asset.quote?.USD?.volume_24h ?? 0);
  const marketCap = Number(asset.market_cap ?? asset.quote?.USD?.market_cap ?? 1);
  const liquidity = Number(asset.bnb_chain_liquidity_score ?? 60);

  if (ema20 > ema50) {
    score += 20;
    reasons.push("EMA20 above EMA50");
  } else {
    score -= 18;
    reasons.push("EMA20 below EMA50");
  }

  score += clamp(change7d * 2, -20, 20);
  if (Math.abs(change7d) >= 3) reasons.push(`7d momentum ${change7d >= 0 ? "+" : ""}${change7d.toFixed(1)}%`);

  if (rsi >= 45 && rsi <= 68) {
    score += 14;
    reasons.push("RSI constructive");
  } else if (rsi > 78) {
    score -= 22;
    risk += 12;
    reasons.push("RSI overheated");
  } else if (rsi < 32) {
    score -= 8;
    risk += 8;
    reasons.push("RSI weak");
  }

  if (macd > 0) score += 14;
  if (macd < 0) score -= 14;
  if (macd !== 0) reasons.push(macd > 0 ? "MACD positive" : "MACD negative");

  if (Math.abs(funding) <= 0.03) score += 5;
  if (funding > 0.08) {
    score -= 12;
    risk += 10;
    reasons.push("long funding crowded");
  }

  if (oiChange > 8 && change7d > 0) {
    score += 7;
    reasons.push("open interest confirms trend");
  }

  score += clamp(sentiment * 12, -12, 12);
  score += clamp(social * 1.5, -8, 8);
  risk += clamp((atr - 6) * 3, 0, 30);

  const volumeRatio = marketCap ? volume / marketCap : 0;
  if (volumeRatio < 0.015) {
    risk += 20;
    reasons.push("thin volume versus market cap");
  }
  if (liquidity < 50) {
    risk += 20;
    reasons.push("weak BNB Chain liquidity");
  } else if (liquidity >= 75) {
    score += 8;
    reasons.push("strong BNB Chain liquidity");
  }

  if (regimeLabel === "risk_off") {
    score -= 18;
    reasons.push("market regime risk_off");
  } else if (regimeLabel === "risk_on") {
    score += 10;
    reasons.push("market regime risk_on");
  }

  const net = score - risk;
  const action = net >= 42 ? "ROTATE_IN" : net >= 18 ? "HOLD" : net >= -5 ? "REDUCE" : "AVOID";
  const confidence = Math.round(clamp(50 + Math.abs(net) * 0.8 - risk * 0.25, 5, 95));
  const targetWeightPct = action === "ROTATE_IN"
    ? clamp(net / 4, 8, policy.maxSinglePositionPct)
    : action === "HOLD"
      ? clamp(net / 5, 3, 10)
      : 0;

  return {
    symbol,
    action,
    score: Number(net.toFixed(2)),
    riskScore: Number(risk.toFixed(2)),
    confidence,
    targetWeightPct: Number(targetWeightPct.toFixed(2)),
    reasons: reasons.slice(0, 6)
  };
}

export function analyzeSnapshot(snapshot, policy) {
  const regime = marketRegime(snapshot);
  let signals = (snapshot.assets ?? [])
    .map((asset) => scoreAsset(asset, regime.label, policy))
    .sort((a, b) => b.targetWeightPct - a.targetWeightPct || b.score - a.score);

  const gross = signals.reduce((sum, signal) => sum + signal.targetWeightPct, 0);
  if (gross > policy.maxGrossExposurePct) {
    const scale = policy.maxGrossExposurePct / gross;
    signals = signals.map((signal) => ({
      ...signal,
      targetWeightPct: Number((signal.targetWeightPct * scale).toFixed(2))
    }));
  }

  return {
    strategy: "Regime Guard TWAK Agent",
    generatedAt: new Date().toISOString(),
    sourceSnapshotAt: snapshot.generated_at,
    regime,
    policy: {
      chain: policy.chain,
      competitionMode: policy.competitionMode,
      maxUsdPerTrade: policy.maxUsdPerTrade,
      competitionMaxUsdPerTrade: policy.competitionMaxUsdPerTrade,
      maxDailyTrades: policy.maxDailyTrades,
      slippagePct: policy.slippagePct,
      dailyLossStopPct: policy.dailyLossStopPct,
      weeklyDrawdownStopPct: policy.weeklyDrawdownStopPct
    },
    signals
  };
}

export function buildTradeIntent(report, policy) {
  const candidate = selectSignalCandidate(report, policy);
  if (!candidate) {
    return { action: "NO_TRADE", reason: "no ROTATE_IN signal above confidence threshold" };
  }

  return buildTradeIntentForSignal(candidate, policy);
}

export function selectSignalCandidate(report, policy) {
  return report.signals.find(
    (signal) => signal.action === "ROTATE_IN" && signal.confidence >= policy.minConfidence
  );
}

export function buildTradeIntentForSignal(signal, policy, overrides = {}) {
  const usdAmount = overrides.usdAmount ?? sizeTradeUsd(signal, policy);
  return {
    action: "SWAP",
    chain: policy.chain,
    intentType: overrides.intentType ?? "ROTATE_IN",
    fromSymbol: overrides.fromSymbol ?? policy.baseStable,
    toSymbol: signal.symbol,
    fromAssetId: policy.tokenAddresses?.[overrides.fromSymbol ?? policy.baseStable] ?? overrides.fromSymbol ?? policy.baseStable,
    toAssetId: policy.tokenAddresses?.[signal.symbol] ?? signal.symbol,
    usdAmount,
    slippagePct: policy.slippagePct,
    rationale: signal.reasons,
    signal
  };
}

export function sizeTradeUsd(signal, policy) {
  const base = Number(policy.maxUsdPerTrade);
  if (!policy.competitionMode) return base;
  if (signal.score < policy.competitionMinSizingScore || signal.confidence < policy.competitionMinSizingConfidence) {
    return base;
  }
  return Number(Math.min(base * policy.competitionSizeMultiplier, policy.competitionMaxUsdPerTrade).toFixed(2));
}

export function buildQualificationIntent(policy, targetSymbol) {
  const symbol = String(targetSymbol).toUpperCase();
  return buildTradeIntentForSignal({
    symbol,
    action: "ROTATE_IN",
    score: 0,
    confidence: 100,
    reasons: ["minimum daily competition trade with stable-to-stable route"]
  }, policy, {
    intentType: "QUALIFICATION",
    usdAmount: Math.min(policy.qualificationTradeUsd, policy.maxUsdPerTrade)
  });
}
