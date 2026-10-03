export function extractInboundWhatsAppMessages(payload) {
  const messages = [];
  for (const entry of payload?.entry || []) {
    for (const change of entry?.changes || []) {
      const value = change?.value || {};
      const metadata = value?.metadata || {};
      for (const message of value?.messages || []) {
        messages.push({
          from: message?.from || null,
          id: message?.id || null,
          timestamp: message?.timestamp || null,
          type: message?.type || null,
          text: message?.text?.body || null,
          phoneNumberId: metadata?.phone_number_id || null,
          displayPhoneNumber: metadata?.display_phone_number || null,
          raw: message,
        });
      }
    }
  }
  return messages;
}
