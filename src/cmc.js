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
        symbols,
        walletAddress: mode === "x402" ? x402WalletAddress() : null,
        payment: snapshot.x402_payment ?? null
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
        paymentRequired: error.paymentRequired === true,
        walletAddress: x402WalletAddress()
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

  if (!process.env.X402_PRIVATE_KEY) {
    const error = new Error("CMC x402 endpoint requires payment transport");
    error.code = "X402_PAYMENT_REQUIRED";
    error.paymentRequired = true;
    throw error;
  }

  const { default: axios } = await import("axios");
  const { wrapAxiosWithPaymentFromConfig, decodePaymentResponseHeader } = await import("@x402/axios");
  const { ExactEvmScheme } = await import("@x402/evm");
  const { privateKeyToAccount } = await import("viem/accounts");

  const account = privateKeyToAccount(process.env.X402_PRIVATE_KEY);
  const api = wrapAxiosWithPaymentFromConfig(axios.create(), {
    schemes: [
      {
        network: process.env.X402_NETWORK ?? "eip155:8453",
        client: new ExactEvmScheme(account)
      }
    ],
    paymentRequirementsSelector: selectAffordableX402Requirement
  });

  try {
    const response = await api.get(endpoint.toString());
    const snapshot = cmcBodyToSnapshot(response.data);
    if (!snapshot.assets.length) {
      throw new Error("CMC x402 quotes response did not include quote data");
    }
    snapshot.x402_payment = decodeX402Payment(response.headers?.["payment-response"], decodePaymentResponseHeader);
    return snapshot;
  } catch (error) {
    if (error.response?.status === 402) {
      const wrapped = new Error("CMC x402 endpoint requires funded payment wallet");
      wrapped.code = "X402_PAYMENT_REQUIRED";
      wrapped.paymentRequired = true;
      throw wrapped;
    }
    throw error;
  }
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
  const uniqueAssets = dedupeCmcAssets(body.data);
  const assets = uniqueAssets.map((asset) => {
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

function dedupeCmcAssets(data) {
  const values = Array.isArray(data) ? data : Object.values(data ?? {});
  const flattened = values.flatMap((value) => Array.isArray(value) ? value : [value]);
  const bySymbol = new Map();

  for (const asset of flattened) {
    if (!asset?.symbol) continue;
    const symbol = String(asset.symbol).toUpperCase();
    const current = bySymbol.get(symbol);
    if (!current || rankAsset(asset, current) < 0) {
      bySymbol.set(symbol, asset);
    }
  }

  return [...bySymbol.values()];
}

function rankAsset(a, b) {
  const rankA = Number(a.cmc_rank ?? Infinity);
  const rankB = Number(b.cmc_rank ?? Infinity);
  if (rankA !== rankB) return rankA - rankB;

  const capA = Number(a.quote?.USD?.market_cap ?? 0);
  const capB = Number(b.quote?.USD?.market_cap ?? 0);
  return capB - capA;
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

function x402WalletAddress() {
  return process.env.X402_WALLET_ADDRESS ?? null;
}

function selectAffordableX402Requirement(_version, accepts) {
  if (!accepts?.length) {
    throw new Error("No x402 payment requirements returned");
  }
  const sorted = [...accepts].sort((a, b) => paymentAtomicAmount(a) - paymentAtomicAmount(b));
  const selected = sorted[0];
  const maxUsdc = Number(process.env.X402_MAX_USDC_PER_REQUEST ?? "0.02");
  const maxAtomic = Math.round(maxUsdc * 1_000_000);
  if (paymentAtomicAmount(selected) > maxAtomic) {
    throw new Error(`x402 request cost exceeds cap ${maxUsdc} USDC`);
  }
  return selected;
}

function paymentAtomicAmount(requirement) {
  return Number(requirement.amount ?? requirement.value ?? requirement.maxAmountRequired ?? 0);
}

function decodeX402Payment(header, decoder) {
  if (!header) return null;
  try {
    return decoder(header);
  } catch {
    return { rawHeader: header };
  }
}
