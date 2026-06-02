export function getTwilioConfig() {
  return {
    accountSid: process.env.TWILIO_ACCOUNT_SID || "",
    authToken: process.env.TWILIO_AUTH_TOKEN || "",
    apiKeySid: process.env.TWILIO_API_KEY_SID || "",
    apiKeySecret: process.env.TWILIO_API_KEY_SECRET || "",
    twimlAppSid: process.env.TWILIO_TWIML_APP_SID || "",
    phoneNumber: process.env.TWILIO_PHONE_NUMBER || "",
    inboundForwardNumber: process.env.TWILIO_INBOUND_FORWARD_NUMBER || "",
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
