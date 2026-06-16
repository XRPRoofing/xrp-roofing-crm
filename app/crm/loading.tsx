export default function CrmLoading() {
  return (
    <div className="space-y-4 p-4 animate-pulse">
      <div className="h-8 w-48 rounded-lg bg-gray-200" />
      <div className="h-4 w-72 rounded bg-gray-100" />
      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {[1, 2, 3, 4, 5, 6].map((i) => (
          <div key={i} className="h-32 rounded-xl bg-gray-100" />
        ))}
      </div>
    </div>
  );
}
