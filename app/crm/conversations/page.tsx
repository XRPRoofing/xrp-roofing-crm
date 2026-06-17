"use client";

import dynamic from "next/dynamic";

const ConversationBoard = dynamic(
  () => import("@/components/crm/conversations/ConversationBoard"),
  {
    ssr: false,
    loading: () => (
      <div className="flex min-h-[400px] gap-4 p-4">
        <div className="w-80 shrink-0 space-y-3">
          <div className="h-10 animate-pulse rounded-lg bg-gray-100" />
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3 rounded-lg p-3">
              <div className="h-10 w-10 animate-pulse rounded-full bg-gray-200" />
              <div className="flex-1 space-y-2">
                <div className="h-3.5 w-3/4 animate-pulse rounded bg-gray-200" />
                <div className="h-3 w-1/2 animate-pulse rounded bg-gray-100" />
              </div>
            </div>
          ))}
        </div>
        <div className="flex-1 animate-pulse rounded-xl bg-gray-50" />
      </div>
    ),
  },
);

export default function ConversationsPage() {
  return <ConversationBoard />;
}
