"""Optional ERC-8004 identity registration through the BNB Agent SDK.

This is separate from the BNB Hack competition registry. The competition
registry is handled by `npm run register`, which calls `twak compete register`.
"""

import os

from bnbagent import AgentEndpoint, ERC8004Agent, EVMWalletProvider


def main() -> None:
    wallet = EVMWalletProvider(
        password=os.environ["WALLET_PASSWORD"],
        private_key=os.environ.get("PRIVATE_KEY"),
    )
    sdk = ERC8004Agent(network=os.getenv("NETWORK", "bsc-mainnet"), wallet_provider=wallet)
    agent_uri = sdk.generate_agent_uri(
        name="Regime Guard TWAK Agent",
        description="Autonomous BNB Chain trading agent using CoinMarketCap signals and TWAK self-custody execution guardrails.",
        endpoints=[
            AgentEndpoint(
                name="status",
                endpoint=os.getenv("AGENT_PUBLIC_STATUS_URL", "https://github.com/imgntn/bnb-regime-guard-agent"),
                version="0.1.0",
            )
        ],
    )
    print(sdk.register_agent(agent_uri=agent_uri))


if __name__ == "__main__":
    main()

