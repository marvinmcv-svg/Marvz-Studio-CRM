/** Skeleton shown inside the app shell while a page's data loads. */
export default function CrmLoading() {
  return (
    <div aria-busy="true" aria-label="Loading" className="animate-pulse">
      <div className="border-b border-line px-4 pb-4 pt-5 md:px-6">
        <div className="h-5 w-48 rounded bg-panel-3" />
        <div className="mt-2 h-3 w-72 max-w-full rounded bg-panel-2" />
      </div>
      <div className="grid gap-3 p-4 sm:grid-cols-2 md:p-6 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => <div key={i} className="card h-20" />)}
      </div>
      <div className="px-4 md:px-6"><div className="card h-64" /></div>
    </div>
  );
}
