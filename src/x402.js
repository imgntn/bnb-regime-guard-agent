const BASE_USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const ERC20_BALANCE_OF_ABI = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "balance", type: "uint256" }]
  }
];

export async function x402WalletStatus() {
  const address = process.env.X402_WALLET_ADDRESS;
  if (!address) {
    return { configured: false, reason: "Run npm run x402:wallet to create a Base payment wallet." };
  }

  const { createPublicClient, formatEther, formatUnits, http } = await import("viem");
  const { base } = await import("viem/chains");
  const client = createPublicClient({
    chain: base,
    transport: http(process.env.BASE_RPC_URL ?? "https://mainnet.base.org")
  });

  const [ethWei, usdcAtomic] = await Promise.all([
    client.getBalance({ address }),
    client.readContract({
      address: BASE_USDC,
      abi: ERC20_BALANCE_OF_ABI,
      functionName: "balanceOf",
      args: [address]
    })
  ]);

  return {
    configured: true,
    chain: "Base mainnet",
    address,
    balances: {
      ETH: Number(formatEther(ethWei)),
      USDC: Number(formatUnits(usdcAtomic, 6))
    },
    minimumSuggested: {
      ETH: 0.001,
      USDC: 1
    },
    recommended: {
      ETH: 0.002,
      USDC: 2
    },
    maxUsdcPerRequest: Number(process.env.X402_MAX_USDC_PER_REQUEST ?? "0.02")
  };
}
