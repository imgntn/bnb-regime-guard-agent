"""Optional ERC-8004 identity registration through the BNB Agent SDK.

This is separate from the BNB Hack competition registry. The competition
registry is handled by `npm run register`, which calls `twak compete register`.
"""

import json
import os
from pathlib import Path

from bnbagent import AgentEndpoint, ERC8004Agent, EVMWalletProvider


def main() -> None:
    agent_card = load_agent_card()
    wallet = EVMWalletProvider(
        password=os.environ["WALLET_PASSWORD"],
        private_key=os.environ.get("PRIVATE_KEY"),
    )
    sdk = ERC8004Agent(network=os.getenv("NETWORK", "bsc-mainnet"), wallet_provider=wallet)
    agent_uri = sdk.generate_agent_uri(
        name=agent_card["name"],
        description=agent_card["description"],
        endpoints=[
            AgentEndpoint(
                name="agent-card",
                endpoint=os.getenv(
                    "AGENT_CARD_URI",
                    "https://raw.githubusercontent.com/imgntn/bnb-regime-guard-agent/main/docs/agent-card.json",
                ),
                version=agent_card["version"],
            ),
            AgentEndpoint(
                name="repository",
                endpoint=agent_card["repository"],
                version=agent_card["version"],
            )
        ],
    )
    print(sdk.register_agent(agent_uri=agent_uri))


def load_agent_card() -> dict:
    card_path = Path(__file__).resolve().parents[1] / "docs" / "agent-card.json"
    if card_path.exists():
        return json.loads(card_path.read_text())
    return {
        "name": "Regime Guard TWAK Agent",
        "version": "0.1.0",
        "description": "Autonomous BNB Chain trading agent using CoinMarketCap signals and TWAK self-custody execution guardrails.",
        "repository": "https://github.com/imgntn/bnb-regime-guard-agent",
    }


if __name__ == "__main__":
    main()
