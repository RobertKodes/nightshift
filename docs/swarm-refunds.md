# Swarm Desk refunds

Swarm Desk settles USDC on Base before it orders IMD work. Failed delivery can leave a full refund owed. Pending delivery and unpaid refunds hold the full receipt; neither earns an Agent Reserve credit. Delivered work earns revenue after its recorded IMD cost, with 50% allocated to the reserve.

Use the owner-only `/swarm` command to review refund-owed order IDs, amounts and original settlement transactions. Look up the payer in that order's saved `payment` record in `swarm-desk.json`. Pay the full recorded USDC amount to that payer on Base from the house wallet. Check the successful receipt, USDC contract, sender, recipient and amount before acknowledging it with `/swarm refund <orderId> <confirmedRefundTx>`.

Acknowledgment records the confirmed manual payout; it does not send a payment. Repeating the same acknowledgment is harmless. A different receipt for the same order, or reusing a receipt for another order, is refused. Keep the original order and refund receipt for reconciliation. Proof reports owed and paid counts and amounts from these records; there is no automatic payout worker.
