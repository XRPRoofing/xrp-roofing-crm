// Twilio requires E.164 phone numbers (e.g. +16233000611) for caller IDs and the
// "from"/"to" fields. Settings are often saved with spaces, dashes, or parens
// (e.g. "+1 623-300-0611"), which Twilio rejects, so normalize defensively.
export function toE164(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (trimmed.startsWith("+")) return `+${trimmed.slice(1).replace(/\D/g, "")}`;
  const digits = trimmed.replace(/\D/g, "");
  if (!digits) return "";
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return `+${digits}`;
}

export function getTwilioConfig() {
  return {
    accountSid: process.env.TWILIO_ACCOUNT_SID || "",
    authToken: process.env.TWILIO_AUTH_TOKEN || "",
    apiKeySid: process.env.TWILIO_API_KEY_SID || "",
    apiKeySecret: process.env.TWILIO_API_KEY_SECRET || "",
    twimlAppSid: process.env.TWILIO_TWIML_APP_SID || "",
    phoneNumber: toE164(process.env.TWILIO_PHONE_NUMBER || ""),
    inboundForwardNumber: toE164(process.env.TWILIO_INBOUND_FORWARD_NUMBER || ""),
  };
}

export function hasTwilioMessagingConfig() {
  const config = getTwilioConfig();
  return Boolean(config.accountSid && config.authToken && config.phoneNumber);
}

export function hasTwilioVoiceConfig() {
  const config = getTwilioConfig();
  return Boolean(config.accountSid && config.authToken && config.apiKeySid && config.apiKeySecret && config.twimlAppSid && config.phoneNumber);
}
