"use client";

import { createContext, useContext } from "react";
import type { BrowserVoiceDevice } from "@/lib/twilio/client";

export type VoiceDeviceContextValue = {
  /** The single shared Twilio Voice Device (null until registered) */
  deviceRef: React.RefObject<BrowserVoiceDevice | null>;
};

const VoiceDeviceContext = createContext<VoiceDeviceContextValue | null>(null);

export const VoiceDeviceProvider = VoiceDeviceContext.Provider;

export function useVoiceDevice(): VoiceDeviceContextValue | null {
  return useContext(VoiceDeviceContext);
}
