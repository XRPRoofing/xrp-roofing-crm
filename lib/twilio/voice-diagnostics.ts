"use client";

import type { BrowserVoiceCall, BrowserVoiceDevice } from "./client";

export type VoiceDiagnosticType =
  | "init"
  | "device-registered"
  | "device-unregistered"
  | "device-error"
  | "device-token-will-expire"
  | "device-state"
  | "device-audio-devices"
  | "media-devices-changed"
  | "call-incoming"
  | "call-accept"
  | "call-reject"
  | "call-cancel"
  | "call-disconnect"
  | "call-error"
  | "call-ringing"
  | "call-mute"
  | "call-unmute"
  | "call-reconnect"
  | "call-reconnected"
  | "call-reconnecting"
  | "call-warning"
  | "call-volume"
  | "call-stats"
  | "ice-state"
  | "peer-connection-state"
  | "audio-context-state"
  | "js-error"
  | "unhandled-rejection"
  | "action-start"
  | "action-accept"
  | "action-decline"
  | "action-end"
  | "action-mute"
  | "action-hold"
  | "action-resume"
  | "action-forward"
  | "action-export"
  | "browser-online"
  | "browser-offline"
  | "visibility";

export interface VoiceDiagnosticEvent {
  type: VoiceDiagnosticType;
  ts: string;
  time: number;
  sessionId: string;
  tabId: string;
  callSid?: string;
  direction?: "inbound" | "outbound";
  payload?: Record<string, unknown>;
}

const MAX_EVENTS = 2000;
const VOLUME_LOG_INTERVAL_MS = 2000;
const STATS_INTERVAL_MS = 10000;
const STORAGE_KEY = "xrp_voice_diagnostics";
const BROADCAST_CHANNEL_NAME = "xrp-voice-diagnostics";

let initialized = false;
let sessionId = "";
let tabId = "";
let events: VoiceDiagnosticEvent[] = [];
const attachedDevices = new WeakSet<object>();
const attachedCalls = new WeakSet<object>();
let broadcastChannel: BroadcastChannel | null = null;
let saveTimer: ReturnType<typeof setTimeout> | null = null;

function generateId(): string {
  return `${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
}

function getSessionId(): string {
  if (typeof window === "undefined") return "";
  if (sessionId) return sessionId;
  const stored = typeof sessionStorage !== "undefined" ? sessionStorage.getItem("xrp_voice_session_id") : null;
  sessionId = stored || generateId();
  if (typeof sessionStorage !== "undefined") sessionStorage.setItem("xrp_voice_session_id", sessionId);
  return sessionId;
}

function getTabId(): string {
  if (!tabId) tabId = generateId();
  return tabId;
}

function loadFromStorage(): VoiceDiagnosticEvent[] {
  if (typeof sessionStorage === "undefined") return [];
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as VoiceDiagnosticEvent[]) : [];
  } catch {
    return [];
  }
}

function saveToStorage(): void {
  if (typeof sessionStorage === "undefined") return;
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(events.slice(-MAX_EVENTS)));
  } catch {
    // storage may be full or unavailable
  }
}

function scheduleSave(): void {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    saveToStorage();
  }, 2000);
}

function pushEvent(event: VoiceDiagnosticEvent): void {
  events.push(event);
  if (events.length > MAX_EVENTS) {
    events = events.slice(events.length - MAX_EVENTS);
  }
  // eslint-disable-next-line no-console
  console.log(`[voice-diag] ${event.type} ${event.ts}`, event);
  if (broadcastChannel) {
    try {
      broadcastChannel.postMessage(event);
    } catch {
      // ignore
    }
  }
  scheduleSave();
}

export function logVoiceDiagnostic(
  partial: Omit<VoiceDiagnosticEvent, "ts" | "time" | "sessionId" | "tabId">,
): void {
  if (typeof window === "undefined") return;
  const event: VoiceDiagnosticEvent = {
    ...partial,
    ts: new Date().toISOString(),
    time: Date.now(),
    sessionId: getSessionId(),
    tabId: getTabId(),
  };
  pushEvent(event);
}

function setupBroadcastChannel(): void {
  if (typeof BroadcastChannel === "undefined") return;
  try {
    broadcastChannel = new BroadcastChannel(BROADCAST_CHANNEL_NAME);
    broadcastChannel.onmessage = (ev: MessageEvent<VoiceDiagnosticEvent | unknown>) => {
      const data = ev.data as VoiceDiagnosticEvent | undefined;
      if (data && data.tabId !== getTabId()) {
        events.push(data);
        if (events.length > MAX_EVENTS) events = events.slice(events.length - MAX_EVENTS);
      }
    };
  } catch {
    // ignore
  }
}

function setupGlobalListeners(): void {
  if (typeof window === "undefined") return;

  window.addEventListener("error", (event) => {
    logVoiceDiagnostic({
      type: "js-error",
      payload: {
        message: event.message,
        filename: event.filename,
        lineno: event.lineno,
        colno: event.colno,
        error:
          event.error instanceof Error
            ? { message: event.error.message, stack: event.error.stack }
            : undefined,
      },
    });
  });

  window.addEventListener("unhandledrejection", (event) => {
    const reason = event.reason;
    logVoiceDiagnostic({
      type: "unhandled-rejection",
      payload: {
        reason:
          reason instanceof Error
            ? { message: reason.message, stack: reason.stack }
            : String(reason),
      },
    });
  });

  window.addEventListener("online", () => logVoiceDiagnostic({ type: "browser-online" }));
  window.addEventListener("offline", () => logVoiceDiagnostic({ type: "browser-offline" }));

  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", () => {
      logVoiceDiagnostic({
        type: "visibility",
        payload: { visibilityState: document.visibilityState },
      });
    });
  }

  if (typeof navigator !== "undefined" && navigator.mediaDevices) {
    navigator.mediaDevices.addEventListener?.("devicechange", () => {
      logVoiceDiagnostic({ type: "media-devices-changed", payload: { source: "navigator" } });
      void enumerateMediaDevices();
    });
    void enumerateMediaDevices();
  }

  window.addEventListener("beforeunload", () => saveToStorage());
  window.addEventListener("pagehide", () => saveToStorage());
}

async function enumerateMediaDevices(): Promise<void> {
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.enumerateDevices) return;
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const payload = devices.map((d) => ({
      kind: d.kind,
      label: d.label,
      deviceId: d.deviceId.slice(-8),
      groupId: d.groupId.slice(-8),
    }));
    logVoiceDiagnostic({
      type: "media-devices-changed",
      payload: { source: "enumerate", devices: payload, count: devices.length },
    });
  } catch (err) {
    logVoiceDiagnostic({
      type: "media-devices-changed",
      payload: { source: "enumerate", error: err instanceof Error ? err.message : String(err) },
    });
  }
}

export function initVoiceDiagnostics(): void {
  if (typeof window === "undefined" || initialized) return;
  initialized = true;
  events = loadFromStorage();
  getSessionId();
  getTabId();
  setupBroadcastChannel();
  setupGlobalListeners();
  logVoiceDiagnostic({
    type: "init",
    payload: {
      url: window.location.href,
      userAgent: navigator.userAgent,
      online: navigator.onLine,
    },
  });

  (window as unknown as Record<string, unknown>).__voiceDiagnostics = {
    getEvents: getVoiceDiagnostics,
    export: exportVoiceDiagnostics,
    download: downloadVoiceDiagnostics,
  };
}

export function getVoiceDiagnostics(): VoiceDiagnosticEvent[] {
  return events.slice();
}

export function exportVoiceDiagnostics(): string {
  return JSON.stringify(
    {
      sessionId: getSessionId(),
      tabId: getTabId(),
      exportedAt: new Date().toISOString(),
      count: events.length,
      events,
    },
    null,
    2,
  );
}

export function downloadVoiceDiagnostics(filename?: string): void {
  if (typeof window === "undefined") return;
  const blob = new Blob([exportVoiceDiagnostics()], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename || `voice-diagnostics-${new Date().toISOString()}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  logVoiceDiagnostic({ type: "action-export", payload: { filename: a.download } });
}

function logDeviceAudio(device: BrowserVoiceDevice): void {
  const audio = (device as unknown as { audio?: Record<string, unknown> }).audio;
  if (!audio) {
    logVoiceDiagnostic({ type: "device-audio-devices", payload: { available: false } });
    return;
  }
  try {
    const inputDevices = (audio as unknown as { availableInputDevices?: Map<string, MediaDeviceInfo> })
      .availableInputDevices;
    const outputDevices = (audio as unknown as { availableOutputDevices?: Map<string, MediaDeviceInfo> })
      .availableOutputDevices;
    const speakerDevices = (audio as unknown as { speakerDevices?: Set<MediaDeviceInfo> }).speakerDevices;
    const ringtoneDevices = (audio as unknown as { ringtoneDevices?: Set<MediaDeviceInfo> }).ringtoneDevices;
    const isOutputSelectionSupported = (audio as unknown as { isOutputSelectionSupported?: boolean })
      .isOutputSelectionSupported;
    const isVolumeSupported = (audio as unknown as { isVolumeSupported?: boolean }).isVolumeSupported;

    const mapDevice = (d: MediaDeviceInfo) => ({
      kind: d.kind,
      label: d.label,
      deviceId: d.deviceId.slice(-8),
      groupId: d.groupId.slice(-8),
    });

    const toArray = (col: Map<string, MediaDeviceInfo> | Set<MediaDeviceInfo> | undefined) => {
      if (!col) return undefined;
      if ("values" in col && typeof col.values === "function") {
        return Array.from((col as unknown as { values(): IterableIterator<MediaDeviceInfo> }).values()).map(
          mapDevice,
        );
      }
      return Array.from(col as Iterable<MediaDeviceInfo>).map(mapDevice);
    };

    logVoiceDiagnostic({
      type: "device-audio-devices",
      payload: {
        availableInputDevices: toArray(inputDevices),
        availableOutputDevices: toArray(outputDevices),
        speakerDevices: toArray(speakerDevices),
        ringtoneDevices: toArray(ringtoneDevices),
        isOutputSelectionSupported,
        isVolumeSupported,
      },
    });
  } catch (err) {
    logVoiceDiagnostic({
      type: "device-audio-devices",
      payload: { error: err instanceof Error ? err.message : String(err) },
    });
  }
}

export function attachVoiceDeviceDiagnostics(device: BrowserVoiceDevice, identity = "crm-agent"): void {
  if (typeof window === "undefined" || attachedDevices.has(device)) return;
  attachedDevices.add(device);

  logVoiceDiagnostic({
    type: "device-state",
    payload: {
      identity,
      state: (device as unknown as { state?: string }).state,
      audioPresent: !!(device as unknown as { audio?: unknown }).audio,
    },
  });

  const on = (event: string, handler: (...args: unknown[]) => void) => {
    try {
      (device as unknown as { on: (e: string, h: (...args: unknown[]) => void) => void }).on(event, handler);
    } catch {
      // ignore if SDK does not support event
    }
  };

  on("registered", () => {
    logVoiceDiagnostic({ type: "device-registered", payload: { identity } });
  });

  on("unregistered", () => {
    logVoiceDiagnostic({ type: "device-unregistered", payload: { identity } });
  });

  on("error", (err) => {
    logVoiceDiagnostic({
      type: "device-error",
      payload: {
        identity,
        error: err instanceof Error ? { message: err.message, stack: err.stack } : String(err),
      },
    });
  });

  on("tokenWillExpire", () => {
    logVoiceDiagnostic({ type: "device-token-will-expire", payload: { identity } });
  });

  on("incoming", () => {
    logVoiceDiagnostic({ type: "call-incoming", payload: { identity } });
  });

  const audio = (device as unknown as {
    audio?: { on?: (event: string, handler: (...args: unknown[]) => void) => void };
  }).audio;
  if (audio?.on) {
    try {
      audio.on("deviceChange", () => {
        logVoiceDiagnostic({ type: "media-devices-changed", payload: { source: "twilio-audio" } });
        logDeviceAudio(device);
      });
    } catch {
      // ignore
    }
  }

  logDeviceAudio(device);
}

export function attachVoiceCallDiagnostics(
  call: BrowserVoiceCall,
  callSid: string,
  direction: "inbound" | "outbound",
): void {
  if (typeof window === "undefined" || attachedCalls.has(call)) return;
  attachedCalls.add(call);

  const latestVolume = { input: 0, output: 0 };
  let volumeInterval: ReturnType<typeof setInterval> | null = null;
  let statsInterval: ReturnType<typeof setInterval> | null = null;
  let disconnected = false;

  const getCurrentCallSid = () => call.parameters?.CallSid || callSid;
  const logEvent = (type: VoiceDiagnosticType, payload?: Record<string, unknown>) => {
    logVoiceDiagnostic({ type, callSid: getCurrentCallSid(), direction, payload });
  };

  const cleanup = () => {
    if (disconnected) return;
    disconnected = true;
    if (volumeInterval) {
      clearInterval(volumeInterval);
      volumeInterval = null;
    }
    if (statsInterval) {
      clearInterval(statsInterval);
      statsInterval = null;
    }
  };

  const on = (event: string, handler: (...args: unknown[]) => void) => {
    try {
      (call as unknown as { on: (e: string, h: (...args: unknown[]) => void) => void }).on(event, handler);
    } catch {
      // ignore if SDK does not support event
    }
  };

  on("accept", () => {
    logEvent("call-accept", { parameters: call.parameters });
  });

  on("reject", () => logEvent("call-reject"));

  on("cancel", () => {
    cleanup();
    logEvent("call-cancel");
  });

  on("disconnect", () => {
    cleanup();
    logEvent("call-disconnect", { parameters: call.parameters });
  });

  on("error", (err) => {
    cleanup();
    logEvent("call-error", { error: err instanceof Error ? { message: err.message, stack: err.stack } : String(err) });
  });

  on("ringing", () => logEvent("call-ringing"));
  on("mute", () => logEvent("call-mute"));
  on("unmute", () => logEvent("call-unmute"));

  on("reconnect", (err) => {
    logEvent("call-reconnect", { error: err instanceof Error ? err.message : String(err) });
  });

  on("reconnecting", (err) => {
    logEvent("call-reconnecting", { error: err instanceof Error ? err.message : String(err) });
  });

  on("reconnected", () => logEvent("call-reconnected"));

  on("warning", (data) => {
    logEvent("call-warning", { warning: data });
  });

  on("volume", (inputVolume, outputVolume) => {
    latestVolume.input = inputVolume as number;
    latestVolume.output = outputVolume as number;
  });

  volumeInterval = setInterval(() => {
    logEvent("call-volume", { inputVolume: latestVolume.input, outputVolume: latestVolume.output });
  }, VOLUME_LOG_INTERVAL_MS);

  // Attach to RTCPeerConnection for ICE state and WebRTC stats.
  try {
    const mediaHandler = (call as unknown as { _mediaHandler?: { peerConnection?: RTCPeerConnection; connection?: RTCPeerConnection } })._mediaHandler;
    const pc = mediaHandler?.peerConnection ?? mediaHandler?.connection;
    if (pc) {
      pc.addEventListener("iceconnectionstatechange", () => {
        logEvent("ice-state", { iceConnectionState: pc.iceConnectionState });
      });

      pc.addEventListener("connectionstatechange", () => {
        logEvent("peer-connection-state", { connectionState: pc.connectionState });
      });

      pc.addEventListener("icecandidateerror", (event) => {
        const ev = event as unknown as { errorCode?: number; errorText?: string; url?: string };
        logEvent("ice-state", { error: { errorCode: ev.errorCode, errorText: ev.errorText, url: ev.url } });
      });

      logEvent("ice-state", {
        iceConnectionState: pc.iceConnectionState,
        connectionState: pc.connectionState,
      });

      statsInterval = setInterval(() => {
        void (async () => {
          try {
            const stats = await pc.getStats();
            const inbound: Record<string, unknown>[] = [];
            const outbound: Record<string, unknown>[] = [];
            const remoteInbound: Record<string, unknown>[] = [];

            stats.forEach((report) => {
              const r = report as unknown as Record<string, unknown>;
              if (r.type === "inbound-rtp" && r.mediaType === "audio") {
                inbound.push({
                  ssrc: r.ssrc,
                  packetsReceived: r.packetsReceived,
                  packetsLost: r.packetsLost,
                  jitter: r.jitter,
                  bytesReceived: r.bytesReceived,
                  audioLevel: r.audioLevel,
                });
              }
              if (r.type === "outbound-rtp" && r.mediaType === "audio") {
                outbound.push({
                  ssrc: r.ssrc,
                  packetsSent: r.packetsSent,
                  bytesSent: r.bytesSent,
                  audioLevel: r.audioLevel,
                });
              }
              if (r.type === "remote-inbound-rtp" && r.mediaType === "audio") {
                remoteInbound.push({
                  ssrc: r.ssrc,
                  roundTripTime: r.roundTripTime,
                  fractionLost: r.fractionLost,
                  jitter: r.jitter,
                });
              }
            });

            logEvent("call-stats", { inbound, outbound, remoteInbound });
          } catch (err) {
            logEvent("call-stats", { error: err instanceof Error ? err.message : String(err) });
          }
        })();
      }, STATS_INTERVAL_MS);
    } else {
      logEvent("ice-state", { available: false, reason: "no peerConnection on call" });
    }
  } catch (err) {
    logEvent("ice-state", { error: err instanceof Error ? err.message : String(err), available: false });
  }
}
