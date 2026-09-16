import { DEFAULT_CENTER, WORLD_ZOOM } from "@/components/map/mapDefaults";
import { MapShell } from "@/components/map/MapShell";

export default function Home() {
  return (
    <MapShell
      initialSelection={{ kind: "none" }}
      initialCenter={DEFAULT_CENTER}
      initialZoom={WORLD_ZOOM}
    />
  );
}
