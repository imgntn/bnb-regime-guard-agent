# DoraHacks Track 1 Submission Draft

## Project Name

Regime Guard TWAK Agent

## Track

Track 1: Autonomous Trading Agents

## Short Description

Regime Guard TWAK Agent is a self-custody BNB Chain trading agent that reads CoinMarketCap market data, generates regime-aware rotation signals, quotes swaps through Trust Wallet Agent Kit, and executes only inside explicit risk guardrails.

## Long Description

Regime Guard TWAK Agent converts CoinMarketCap market data into a daily BNB Chain spot-rotation decision. It classifies the broader market as risk-on, mixed, or risk-off, ranks eligible assets by trend, momentum, volatility, and liquidity, then creates one guarded swap intent. The execution layer is Trust Wallet Agent Kit: every live trade is quoted first through `twak swap --quote-only`, checked against allowlists, slippage, daily trade count, and per-trade size limits, and only then submitted through the local self-custody TWAK wallet.

The agent defaults to dry-run mode and requires two explicit live-trading environment flags before it can execute. This keeps custody with the user while giving judges a reproducible agent loop, transparent strategy report, and clear on-chain proof path.

## CoinMarketCap Usage

The agent uses CoinMarketCap market data as the signal source. In demo mode it falls back to a CMC-shaped sample snapshot. In live mode it can use CMC REST via `CMC_API_KEY`, with the repo structured so x402 access can be routed through TWAK for paid requests.

## Trust Wallet Agent Kit Usage

TWAK is the only execution layer. The agent uses:

- `twak auth status` and `twak wallet status` for setup checks.
- `twak compete status` and `twak compete register` for BNB Hack registration.
- `twak swap --quote-only` before any trade.
- `twak swap` for live BSC execution only when live guardrails are explicitly enabled.

## BNB AI Agent SDK Usage

The repo includes optional ERC-8004 identity registration through the BNB Agent SDK in `scripts/register-bnb-agent.py`. This is separate from the BNB Hack competition wallet registration.

## Repository Link

https://github.com/imgntn/bnb-regime-guard-agent

## Logo

`docs/assets/regime-guard-agent-logo-480.png`

## Demo Instructions

```bash
npm install
npm test
npm run analyze
npm run once:dry
npm run compete:status
```

For live execution after TWAK setup and wallet funding:

```bash
LIVE_TRADING=1 TWAK_CONFIRM_LIVE=I_ACCEPT_LIVE_TRADING_RISK npm run once:live
```

## On-Chain Proof

- Agent wallet address: add after `npm run compete:status`.
- Registration transaction hash: add after `npm run register`.
- Trade transaction hash: add after live execution during the competition window.
