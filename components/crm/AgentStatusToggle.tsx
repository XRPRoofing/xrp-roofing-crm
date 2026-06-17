"use client";

import { useEffect, useState } from "react";
import { type AgentStatus, readLocalAgentStatus, setAgentStatus } from "@/lib/agent-status";

const STATUS_CONFIG: Record<AgentStatus, { label: string; color: string; bg: string }> = {
  online: { label: "Online", color: "bg-green-500", bg: "hover:bg-green-50" },
  busy: { label: "Busy", color: "bg-yellow-500", bg: "hover:bg-yellow-50" },
  offline: { label: "Offline", color: "bg-red-500", bg: "hover:bg-red-50" },
};

const STATUS_ORDER: AgentStatus[] = ["online", "busy", "offline"];

interface AgentStatusToggleProps {
  userId: string;
}

export default function AgentStatusToggle({ userId }: AgentStatusToggleProps) {
  const [status, setStatus] = useState<AgentStatus>(readLocalAgentStatus);
  const [menuOpen, setMenuOpen] = useState(false);

  // Set agent online when component mounts, offline when unmounting (page close)
  useEffect(() => {
    void setAgentStatus(userId, "online");
    setStatus("online");

    function handleBeforeUnload() {
      // Use sendBeacon for reliable status update on page close
      const url = "/api/agents/status";
      const body = JSON.stringify({ status: "offline" });
      navigator.sendBeacon(url, new Blob([body], { type: "application/json" }));
    }

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
      void setAgentStatus(userId, "offline");
    };
  }, [userId]);

  function handleSelect(newStatus: AgentStatus) {
    setStatus(newStatus);
    setMenuOpen(false);
    void setAgentStatus(userId, newStatus);
  }

  const current = STATUS_CONFIG[status];

  return (
    <div className="relative">
      <button
        onClick={() => setMenuOpen(!menuOpen)}
        className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm font-medium text-gray-700 transition hover:bg-gray-100"
        aria-label={`Status: ${current.label}`}
      >
        <span className={`inline-block h-2.5 w-2.5 rounded-full ${current.color}`} />
        <span className="hidden sm:inline">{current.label}</span>
      </button>

      {menuOpen && (
        <>
          <div className="fixed inset-0 z-[60]" onClick={() => setMenuOpen(false)} />
          <div className="absolute right-0 top-full z-[61] mt-1 w-36 rounded-lg border border-gray-200 bg-white py-1 shadow-lg">
            {STATUS_ORDER.map((s) => {
              const cfg = STATUS_CONFIG[s];
              return (
                <button
                  key={s}
                  onClick={() => handleSelect(s)}
                  className={`flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm ${cfg.bg} ${s === status ? "bg-gray-50 font-medium" : ""}`}
                >
                  <span className={`inline-block h-2.5 w-2.5 rounded-full ${cfg.color}`} />
                  {cfg.label}
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
