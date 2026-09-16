import { PanelFrame } from "@/components/panel/PanelFrame";

/** Shown while nothing is selected (spec §3, PRD 3 Flow A step 1). */
export function WelcomeCard() {
  return (
    <PanelFrame title="Map Chat">
      <p className="text-muted-foreground">Click on the map to start a chat</p>
    </PanelFrame>
  );
}
