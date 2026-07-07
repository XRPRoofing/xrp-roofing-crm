// Build the webhook URL that advances the inbound call to a given routing step.
export function routeStepUrlFor(origin: string, option: string, stepIndex: number): string {
  const url = new URL("/api/twilio/webhooks/route-step", origin);
  url.searchParams.set("option", option);
  url.searchParams.set("step", String(stepIndex));
  return url.toString();
}
