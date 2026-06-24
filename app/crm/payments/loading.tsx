export default function PaymentsLoading() {
  return (
    <div className="space-y-4 p-4 lg:p-6">
      <div className="h-8 w-36 animate-pulse rounded-lg bg-gray-200" />
      <div className="space-y-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="flex items-center gap-4 rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
            <div className="h-5 w-20 animate-pulse rounded bg-gray-200" />
            <div className="h-4 w-32 animate-pulse rounded bg-gray-100" />
            <div className="flex-1" />
            <div className="h-4 w-16 animate-pulse rounded bg-gray-100" />
          </div>
        ))}
      </div>
    </div>
  );
}
