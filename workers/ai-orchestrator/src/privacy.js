const SENSITIVE_KEY = /(password|secret|token|authorization|otp|one.?time|cvv|cvc|card.?number|pan.?number|aadhaar|aadhar|ifsc|bank.?account|account.?number|phone|mobile|email|address|dob|date.?of.?birth)/i;

export function redactSensitive(value, depth = 0) {
  if (depth > 8) return "[REDACTED:MAX_DEPTH]";
  if (Array.isArray(value)) return value.slice(0, 100).map(item => redactSensitive(item, depth + 1));
  if (value && typeof value === "object") {
    const output = {};
    for (const [key, child] of Object.entries(value).slice(0, 100)) {
      output[key] = SENSITIVE_KEY.test(key) ? "[REDACTED]" : redactSensitive(child, depth + 1);
    }
    return output;
  }
  if (typeof value === "string") {
    return value.slice(0, 10000)
      .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[REDACTED_EMAIL]")
      .replace(/(?:\+?91[\s-]?)?[6-9]\d{9}\b/g, "[REDACTED_PHONE]")
      .replace(/\b\d{12}\b/g, "[REDACTED_ID]")
      .replace(/\b\d{13,19}\b/g, "[REDACTED_PAYMENT_NUMBER]");
  }
  if (typeof value === "number" || typeof value === "boolean" || value === null) return value;
  return String(value).slice(0, 1000);
}
