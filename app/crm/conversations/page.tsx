"use client";

import dynamic from "next/dynamic";

const ConversationBoard = dynamic(
  () => import("@/components/crm/conversations/ConversationBoard"),
  {
    ssr: false,
    loading: () => (
      <div className="flex min-h-[400px] items-center justify-center">
        <div className="flex items-center gap-3 rounded-lg border border-gray-200 bg-white px-5 py-4 text-sm font-medium text-gray-600 shadow-sm">
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
          Loading conversations...
        </div>
      </div>
    ),
  },
);

export default function ConversationsPage() {
  return <ConversationBoard />;
}
