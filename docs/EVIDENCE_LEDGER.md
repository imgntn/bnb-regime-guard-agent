# Evidence Ledger

Regime Guard writes a local decision receipt for every dry-run and live run.

Files:

- `state/evidence-ledger.jsonl`: append-only local decision receipts.
- `state/latest-decision-receipt.json`: most recent receipt for demo review.
- `docs/agent-card.json`: public agent metadata used by the BNB Agent SDK registration path.

Receipt fields:

- `dataAccess`: whether the run used CMC REST, CMC x402 MCP, x402 fallback, or sample data.
- `hashes`: SHA-256 hashes for the normalized market snapshot, policy, strategy report, and intent.
- `decision`: regime, selected symbol, route mode, action, symbols, size, and validation result.
- `quote`: TWAK quote summary with provider, input, output, minimum received, and price impact.
- `execution`: transaction hash fields when a live swap returns them.

The ledger is intentionally ignored by git because it can contain live wallet activity. A judge-facing demo can show the latest receipt plus the matching BSC transaction hash.
