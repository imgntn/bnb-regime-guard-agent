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
    competitionMode: boolEnv("COMPETITION_MODE", policy.competitionMode),
    competitionMaxUsdPerTrade: Number(process.env.COMPETITION_MAX_USD_PER_TRADE ?? policy.competitionMaxUsdPerTrade),
    competitionSizeMultiplier: Number(process.env.COMPETITION_SIZE_MULTIPLIER ?? policy.competitionSizeMultiplier),
    competitionMinSizingScore: Number(process.env.COMPETITION_MIN_SIZING_SCORE ?? policy.competitionMinSizingScore),
    competitionMinSizingConfidence: Number(process.env.COMPETITION_MIN_SIZING_CONFIDENCE ?? policy.competitionMinSizingConfidence),
    maxUsdPerTrade: Number(process.env.MAX_USD_PER_TRADE ?? policy.maxUsdPerTrade),
    maxDailyTrades: Number(process.env.MAX_DAILY_TRADES ?? policy.maxDailyTrades),
    dailyTradeFloor: Number(process.env.DAILY_TRADE_FLOOR ?? policy.dailyTradeFloor),
    qualificationTradeUsd: Number(process.env.QUALIFICATION_TRADE_USD ?? policy.qualificationTradeUsd),
    qualificationMaxRoundTripDragPct: Number(process.env.QUALIFICATION_MAX_ROUND_TRIP_DRAG_PCT ?? policy.qualificationMaxRoundTripDragPct),
    dailyLossStopPct: Number(process.env.MAX_DAILY_LOSS_PCT ?? policy.dailyLossStopPct),
    weeklyDrawdownStopPct: Number(process.env.MAX_WEEKLY_DRAWDOWN_PCT ?? policy.weeklyDrawdownStopPct),
    positionStopLossPct: Number(process.env.POSITION_STOP_LOSS_PCT ?? policy.positionStopLossPct),
    takeProfitPct: Number(process.env.TAKE_PROFIT_PCT ?? policy.takeProfitPct),
    maxPositionHoldHours: Number(process.env.MAX_POSITION_HOLD_HOURS ?? policy.maxPositionHoldHours),
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
