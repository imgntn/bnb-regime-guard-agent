import { readJson } from "./config.js";

const DEFAULT_SYMBOLS = ["BNB", "CAKE", "TWT", "USDT", "USDC", "FDUSD"];

export async function loadMarketSnapshot({ symbols = DEFAULT_SYMBOLS } = {}) {
  if (process.env.CMC_API_KEY) {
    return fetchFromCmcRest(symbols);
  }
  return readJson("data/sample-market-snapshot.json");
}

async function fetchFromCmcRest(symbols) {
  const url = new URL("https://pro-api.coinmarketcap.com/v1/cryptocurrency/quotes/latest");
  url.searchParams.set("symbol", symbols.join(","));
  url.searchParams.set("convert", "USD");

  const response = await fetch(url, {
    headers: {
      "X-CMC_PRO_API_KEY": process.env.CMC_API_KEY,
      Accept: "application/json"
    }
  });
  if (!response.ok) {
    throw new Error(`CMC REST request failed: ${response.status} ${response.statusText}`);
  }

  const body = await response.json();
  const assets = Object.values(body.data ?? {}).map((asset) => {
    const quote = asset.quote?.USD ?? {};
    const price = Number(quote.price ?? 0);
    const change7d = Number(quote.percent_change_7d ?? 0);
    return {
      symbol: asset.symbol,
      price,
      volume_24h: quote.volume_24h,
      market_cap: quote.market_cap,
      change_7d_pct: change7d,
      ema_20: price * (change7d >= 0 ? 0.99 : 1.01),
      ema_50: price,
      rsi_14: change7d >= 0 ? 58 : 42,
      macd_histogram: change7d >= 0 ? 0.01 : -0.01,
      atr_pct: Math.min(14, Math.max(4, Math.abs(Number(quote.percent_change_24h ?? 0)) * 2)),
      funding_rate_pct: 0,
      open_interest_change_pct: 0,
      news_sentiment: 0,
      social_dominance_change_pct: 0,
      bnb_chain_liquidity_score: ["BNB", "USDT", "USDC", "FDUSD"].includes(asset.symbol) ? 90 : 65,
      eligible: true
    };
  });

  return {
    generated_at: new Date().toISOString(),
    market: {
      fear_greed: 50,
      btc_24h_change_pct: 0,
      global_market_cap_24h_change_pct: 0,
      stablecoin_dominance_change_pct: 0
    },
    assets
  };
}

