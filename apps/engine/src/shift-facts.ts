/**
 * The fixed facts about $SHIFT, in one place: the Telegram assistant and the public MCP's shift_token
 * tool read the same words. Live numbers (price, staked, burned) are read where they are used.
 */
export const tokenRules = (u: string) => ({
  supply: "1,000,000,000 fixed, 18 decimals. No mint, no pause, no blacklist. 88.89% (888.9M) seeded in the Uniswap v4 pool, 1.11% (11.1M) dev wallet (public), 10% (100M) to the IMD swarm. No presale, no private round, no unlock schedule.",
  launch: "Launched through IMD's swarm: built, tested twice and audited by 4 specialist agents and a judge, deployed by IMD on Ethereum. Not audited by an outside firm. The pool opened at a 10 ETH market cap. Launch was gated: only the treasury could make the first buy, against sniper bots. The treasury's first buy was 0.91 ETH for 81.49M SHIFT, paid into the pool like any buyer.",
  fees: "Buys pay only the 1.25% pool fee (1% to the launch payer, the dev wallet; 0.25% to the IMD network). Sells also pay 5% (2.5% in SHIFT, 2.5% in ETH), which can only go down, never up.",
  oneRule: "Every NIGHTSHIFT fee is split the same way, hard-coded: 40% rewards (half to SHIFT stakers, half to NIGHT FROGS holders), 20% dev wallet, 20% treasury, 20% burned. SHIFT is burned to 0x...dEaD; every day at 03:00 UTC the NIGHTSHIFT keeper buys IMD with the ETH part and burns it at IMD's BurnExecutor 0xe29386719c155b6847ad5a4e97c6674f10ffc750. The keeper only pays gas and cannot move funds anywhere else.",
  staking: `At ${u}/stake: stake SHIFT with a lock from 0 to 730 days (24 months). Stakers share 20% of every NIGHTSHIFT fee (half of the 40% rewards part; the other half goes to NIGHT FROGS holders), streamed over 7 days in ETH and SHIFT. More stake and a longer lock earn a bigger share. Locked stake cannot be withdrawn early by anyone, the owner included. Rewards can be claimed any time; unlocked stake can be withdrawn any time.`,
});
