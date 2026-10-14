export default function Loading() {
  return (
    <div className="animate-pulse">
      <div className="bg-muted mb-6 h-8 w-48 rounded-md" />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="bg-muted h-24 rounded-xl" />
        ))}
      </div>
      <div className="bg-muted mt-6 h-64 rounded-xl" />
    </div>
  );
}
