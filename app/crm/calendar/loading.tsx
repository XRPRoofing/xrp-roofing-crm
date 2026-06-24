export default function CalendarLoading() {
  return (
    <div className="space-y-4 p-4 lg:p-6">
      <div className="flex items-center justify-between">
        <div className="h-8 w-40 animate-pulse rounded-lg bg-gray-200" />
        <div className="flex gap-2">
          <div className="h-9 w-9 animate-pulse rounded-lg bg-gray-200" />
          <div className="h-9 w-9 animate-pulse rounded-lg bg-gray-200" />
        </div>
      </div>
      <div className="h-96 animate-pulse rounded-xl bg-white shadow-sm" />
    </div>
  );
}
