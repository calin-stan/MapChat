export type MapStatusProps = {
  truncated: boolean;
  refreshFailed: boolean;
};

/** Top-centre pill (spec §3): truncation wins over a failed refresh; nothing when neither applies. */
export function MapStatus({ truncated, refreshFailed }: MapStatusProps) {
  const text = truncated
    ? "Zoom in to see more rooms"
    : refreshFailed
      ? "Couldn't refresh rooms"
      : null;
  if (text === null) return null;
  return (
    <div
      role="status"
      className="absolute top-4 left-1/2 z-10 -translate-x-1/2 rounded-full bg-background/90 px-3 py-1 text-sm shadow-sm ring-1 ring-foreground/10"
    >
      {text}
    </div>
  );
}
