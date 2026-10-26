/** Shown instantly while a panel tab renders on the server — tab switches never feel frozen. */
export default function Loading() {
  return (
    <div aria-busy="true" aria-label="Загрузка" className="animate-pulse">
      <div className="h-8 w-56 rounded bg-stone-200/70 mb-3" />
      <div className="h-4 w-96 max-w-full rounded bg-stone-200/60 mb-6" />
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-5">
        {Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-24 rounded-xl bg-stone-200/50" />)}
      </div>
      <div className="h-64 rounded-xl bg-stone-200/40" />
    </div>
  );
}
