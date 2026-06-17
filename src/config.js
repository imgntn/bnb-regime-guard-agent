import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

loadDotEnv();
applyEnvAliases();

export function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, relativePath), "utf8"));
}

export function loadPolicy() {
  const policy = readJson("config/risk-policy.json");
  return {
    ...policy,
    maxUsdPerTrade: Number(process.env.MAX_USD_PER_TRADE ?? policy.maxUsdPerTrade),
    maxDailyTrades: Number(process.env.MAX_DAILY_TRADES ?? policy.maxDailyTrades),
    dailyLossStopPct: Number(process.env.MAX_DAILY_LOSS_PCT ?? policy.dailyLossStopPct),
    weeklyDrawdownStopPct: Number(process.env.MAX_WEEKLY_DRAWDOWN_PCT ?? policy.weeklyDrawdownStopPct),
    slippagePct: Number(process.env.SLIPPAGE_PCT ?? policy.slippagePct)
  };
}

export function boolEnv(name, fallback = false) {
  const value = process.env[name];
  if (value === undefined || value === "") return fallback;
  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

function loadDotEnv() {
  const envPath = path.join(ROOT, ".env");
  if (!fs.existsSync(envPath)) return;

  const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const equals = trimmed.indexOf("=");
    if (equals === -1) continue;
    const key = trimmed.slice(0, equals).trim();
    let value = trimmed.slice(equals + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

function applyEnvAliases() {
  const aliases = {
    TW_ACCESS_ID: "TWAK_ACCESS_ID",
    TW_HMAC_SECRET: "TWAK_HMAC_SECRET"
  };
  for (const [alias, canonical] of Object.entries(aliases)) {
    if (!process.env[canonical] && process.env[alias]) {
      process.env[canonical] = process.env[alias];
    }
  }
}
