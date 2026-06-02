import { getTwilioConfig } from "@/lib/twilio/config";
import type { TwilioConversationEvent } from "@/types/twilio-conversations";

interface RecordingInsightsInput {
  callSid?: string;
  recordingUrl?: string;
  from?: string;
  to?: string;
  direction?: "inbound" | "outbound";
  payload: Record<string, unknown>;
}

function getBasicAuthHeader() {
  const config = getTwilioConfig();
  if (!config.accountSid || !config.authToken) return undefined;

  return `Basic ${Buffer.from(`${config.accountSid}:${config.authToken}`).toString("base64")}`;
}

async function downloadRecording(recordingUrl: string) {
  const auth = getBasicAuthHeader();
  const response = await fetch(recordingUrl, { headers: auth ? { Authorization: auth } : undefined });

  if (!response.ok) throw new Error(`Unable to download Twilio recording (${response.status})`);

  return response.blob();
}

async function transcribeRecording(blob: Blob) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is not configured");

  const form = new FormData();
  form.append("file", blob, "call-recording.mp3");
  form.append("model", "gpt-4o-mini-transcribe");
  form.append("response_format", "json");

  const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });

  if (!response.ok) throw new Error(`OpenAI transcription failed (${response.status}): ${await response.text()}`);

  const data = await response.json() as { text?: string };
  return data.text || "";
}

async function summarizeTranscript(transcript: string) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is not configured");

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      temperature: 0.2,
      messages: [
        {
          role: "system",
          content: "You summarize roofing CRM phone calls. Return concise, useful CRM notes with customer issue, roof/job details, insurance/payment details, urgency, next steps, and follow-up tasks when mentioned.",
        },
        {
          role: "user",
          content: `Transcript:\n${transcript}`,
        },
      ],
    }),
  });

  if (!response.ok) throw new Error(`OpenAI summary failed (${response.status}): ${await response.text()}`);

  const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
  return data.choices?.[0]?.message?.content?.trim() || "Summary unavailable.";
}

export async function createCallRecordingInsights(input: RecordingInsightsInput): Promise<TwilioConversationEvent | null> {
  if (!input.recordingUrl) return null;

  const recordingBlob = await downloadRecording(input.recordingUrl);
  const transcript = await transcribeRecording(recordingBlob);
  const summary = transcript ? await summarizeTranscript(transcript) : "Transcript unavailable.";

  return {
    id: crypto.randomUUID(),
    type: "call_recording",
    direction: input.direction,
    from: input.from,
    to: input.to,
    status: "completed",
    callSid: input.callSid,
    recordingUrl: input.recordingUrl,
    body: summary,
    payload: {
      ...input.payload,
      recordingUrl: input.recordingUrl,
      transcript,
      summary,
      processedAt: new Date().toISOString(),
    },
    createdAt: new Date().toISOString(),
  };
}
