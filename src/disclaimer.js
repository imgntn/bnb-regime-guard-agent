export const LIVE_TRADING_ACK = "I_ACCEPT_LIVE_TRADING_RISK";
export const LIVE_TRADING_DISCLAIMER_VERSION = "2026-06-18";

export const LIVE_TRADING_DISCLAIMER_LINES = [
  "Regime Guard TWAK Agent is experimental hackathon software for the BNB Hack Track 1 competition.",
  "It is not financial, investment, legal, tax, or professional trading advice.",
  "Live mode can submit real BSC transactions through the user's local TWAK wallet and can lose money, including from bad signals, slippage, gas, fees, smart-contract risk, data/API outages, wallet compromise, and market volatility.",
  "The user keeps custody of keys and is solely responsible for wallet funding, position size, legal compliance, tax consequences, and every transaction the agent signs.",
  "The software does not guarantee profit, contest eligibility, ranking, judging outcomes, or prize payment.",
  "Use dry-run mode first, inspect receipts and quotes, keep trade sizes small, and only enable live mode with funds you are prepared to lose."
];

export function liveTradingDisclaimerText() {
  return [
    "LIVE TRADING DISCLAIMER",
    `Version: ${LIVE_TRADING_DISCLAIMER_VERSION}`,
    ...LIVE_TRADING_DISCLAIMER_LINES.map((line) => `- ${line}`),
    `Live execution requires TWAK_CONFIRM_LIVE=${LIVE_TRADING_ACK}.`
  ].join("\n");
}

export function liveTradingDisclaimerReceipt() {
  return {
    version: LIVE_TRADING_DISCLAIMER_VERSION,
    acknowledgementEnv: "TWAK_CONFIRM_LIVE",
    acknowledgementValue: LIVE_TRADING_ACK,
    text: LIVE_TRADING_DISCLAIMER_LINES
  };
}

export function printLiveTradingDisclaimer(stream = process.stderr) {
  stream.write(`${liveTradingDisclaimerText()}\n\n`);
}
