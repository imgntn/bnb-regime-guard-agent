import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

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

