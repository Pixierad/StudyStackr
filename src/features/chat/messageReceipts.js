// A reader appears once, below the newest message they have actually read.
export function latestReadersByMessage(messages, receipts, userId) {
  const latest = new Map();
  const order = new Map(messages.filter((m) => !m.isLocal && !m.isSystem).map((m, i) => [m.id, i]));
  for (const receipt of receipts) {
    if (!receipt.readAt || receipt.userId === userId || !order.has(receipt.messageId)) continue;
    const previous = latest.get(receipt.userId);
    if (!previous || order.get(receipt.messageId) > order.get(previous.messageId)) {
      latest.set(receipt.userId, receipt);
    }
  }
  const result = new Map();
  for (const receipt of latest.values()) {
    result.set(receipt.messageId, [...(result.get(receipt.messageId) || []), receipt]);
  }
  return result;
}
