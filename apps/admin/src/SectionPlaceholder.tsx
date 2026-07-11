// Route stub for sections not yet ported (TER-511–515). Each port issue
// replaces exactly one of these with its real implementation.
export default function SectionPlaceholder({ title }: { title: string }) {
  return (
    <div className="py-8">
      <h2 className="text-lg font-semibold text-foreground">{title}</h2>
      <p className="mt-1 text-sm text-muted-foreground">Coming in Phase 1.</p>
    </div>
  );
}
