import { boolEnv, readJson } from "./config.js";

const DEFAULT_SYMBOLS = ["BNB", "CAKE", "TWT", "USDT", "USDC", "FDUSD"];
const DEFAULT_X402_MCP_URL = "https://mcp.coinmarketcap.com/x402/mcp";
const DEFAULT_X402_QUOTES_URL = "https://pro-api.coinmarketcap.com/x402/v3/cryptocurrency/quotes/latest";

export async function loadMarketSnapshot({ symbols = DEFAULT_SYMBOLS } = {}) {
  if (boolEnv("CMC_USE_X402")) {
    return withAgentHubAccess(fetchFromCmcX402(symbols), symbols, "x402");
  }
  if (process.env.CMC_API_KEY) {
    return withAgentHubAccess(fetchFromCmcRest(symbols), symbols, "rest");
  }
  return {
    ...readJson("data/sample-market-snapshot.json"),
    agent_hub_access: {
      mode: "sample-fallback",
      paid: false,
      endpoint: null,
      tool: null,
      symbols
    }
  };
}

async function withAgentHubAccess(promise, symbols, mode) {
  try {
    const snapshot = await promise;
    return {
      ...snapshot,
      agent_hub_access: {
        mode,
        paid: mode === "x402",
        endpoint: mode === "x402" ? x402Endpoint() : "https://pro-api.coinmarketcap.com",
        tool: mode === "x402" ? x402ToolName() : "quotes/latest",
        symbols
      }
    };
  } catch (error) {
    if (mode !== "x402" || !boolEnv("CMC_X402_FALLBACK", true)) {
      throw error;
    }
    return {
      ...readJson("data/sample-market-snapshot.json"),
      agent_hub_access: {
        mode: "x402-fallback",
        paid: false,
        endpoint: x402Endpoint(),
        tool: x402ToolName(),
        symbols,
        error: error.message,
        code: error.code ?? null,
        paymentRequired: error.paymentRequired === true
      }
    };
  }
}

async function fetchFromCmcX402(symbols) {
  if (process.env.CMC_X402_TRANSPORT === "mcp") {
    return fetchFromCmcX402Mcp(symbols);
  }
  const endpoint = new URL(process.env.CMC_X402_QUOTES_URL ?? DEFAULT_X402_QUOTES_URL);
  endpoint.searchParams.set("symbol", symbols.join(","));
  endpoint.searchParams.set("convert", "USD");

  const response = await fetch(endpoint);
  if (response.status === 402) {
    const error = new Error("CMC x402 endpoint requires payment transport");
    error.code = "X402_PAYMENT_REQUIRED";
    error.paymentRequired = true;
    throw error;
  }
  if (!response.ok) {
    throw new Error(`CMC x402 quotes request failed: ${response.status} ${response.statusText}`);
  }

  return cmcBodyToSnapshot(await response.json());
}

async function fetchFromCmcX402Mcp(symbols) {
  const endpoint = process.env.CMC_X402_MCP_URL ?? DEFAULT_X402_MCP_URL;
  const toolName = x402ToolName();
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Accept: "application/json, text/event-stream",
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: `regime-guard-${Date.now()}`,
      method: "tools/call",
      params: {
        name: toolName,
        arguments: {
          symbol: symbols.join(","),
          convert: "USD"
        }
      }
    })
  });

  if (response.status === 402) {
    const error = new Error("CMC x402 endpoint requires payment transport");
    error.code = "X402_PAYMENT_REQUIRED";
    error.paymentRequired = true;
    throw error;
  }
  if (!response.ok) {
    throw new Error(`CMC x402 MCP request failed: ${response.status} ${response.statusText}`);
  }

  const body = await parseMcpResponse(response);
  const snapshot = cmcBodyToSnapshot(body);
  if (!snapshot.assets.length) {
    throw new Error("CMC x402 MCP response did not include quote data; check tool discovery or transport configuration");
  }
  return snapshot;
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
  return cmcBodyToSnapshot(body);
}

async function parseMcpResponse(response) {
  const text = await response.text();
  const eventLine = text.split(/\r?\n/).find((line) => line.startsWith("data: "));
  const parsed = JSON.parse(eventLine ? eventLine.slice(6) : text);
  const content = parsed.result?.content?.[0]?.text;
  if (content) return JSON.parse(content);
  return parsed.result ?? parsed;
}

function cmcBodyToSnapshot(body) {
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

function x402Endpoint() {
  return process.env.CMC_X402_TRANSPORT === "mcp"
    ? (process.env.CMC_X402_MCP_URL ?? DEFAULT_X402_MCP_URL)
    : (process.env.CMC_X402_QUOTES_URL ?? DEFAULT_X402_QUOTES_URL);
}

function x402ToolName() {
  return process.env.CMC_X402_TRANSPORT === "mcp"
    ? (process.env.CMC_X402_TOOL_NAME ?? "cryptocurrency_quotes_latest")
    : "x402/v3/cryptocurrency/quotes/latest";
}
