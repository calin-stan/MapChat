import type { ReactNode } from "react";

/**
 * Where the one floating panel sits on the map page (map-shell design §3):
 * top right, 24rem wide, never taller than the viewport minus its margins.
 * A flex column, so the panel inside can shrink and scroll its own body.
 */
export function PanelSlot({ children }: { children: ReactNode }) {
  return (
    <div className="absolute top-4 right-4 z-10 flex max-h-[calc(100dvh-2rem)] w-96 flex-col">
      {children}
    </div>
  );
}
