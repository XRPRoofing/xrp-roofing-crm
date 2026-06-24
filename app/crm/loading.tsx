export default function CrmLoading() {
  return (
    <div className="space-y-4 p-4 lg:p-6">
      <div className="h-24 animate-pulse rounded-xl bg-white shadow-sm" />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-20 animate-pulse rounded-lg bg-white shadow-sm" />
        ))}
      </div>
      <div className="h-64 animate-pulse rounded-xl bg-white shadow-sm" />
    </div>
  );
}
