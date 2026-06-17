# Deployment Runbook

## Local Self-Custody Deployment

Track 1 execution should run on a machine where the user controls the TWAK wallet and OS keychain.

See `docs/TWAK_WALLET_SETUP.md` for the full credential, wallet, funding, and registration flow.

1. Install Node.js 20+.
2. Clone the repo.
3. Run `npm install`.
4. Configure TWAK credentials with `twak init`.
5. Create or import the agent wallet with `twak wallet create`.
6. Fund the BSC agent wallet with a non-zero amount of eligible assets before the live trading window.
7. Register the wallet with `npm run register`.
8. Run one dry pass: `npm run once:dry`.
9. Run live only with explicit flags: `npm run once:live`.

## Suggested Competition Cadence

Run once per day during the June 22-28 live trading window. The default policy caps trading at one swap per day and `MAX_USD_PER_TRADE=5`.

## Do Not Deploy Secrets To Public CI

Do not put TWAK wallet passwords, private keys, API keys, or mnemonics in GitHub Actions secrets for this hackathon entry unless you are intentionally moving custody into CI. The recommended deployment is local/self-custody.

## Required Submission Evidence

- Public repo link.
- Agent wallet address.
- BSC registration transaction hash from `npm run register`.
- At least one BSC trade transaction hash from `npm run once:live`.
- Short explanation of the strategy and guardrails.
