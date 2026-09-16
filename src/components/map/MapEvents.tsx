"use client";

import { useCallback, useEffect, useRef } from "react";
import { useMap, useMapEvents } from "react-leaflet";

import { boundsToViewport, type LatLng, type Viewport } from "@/lib/map/viewport";

export type MapEventsProps = {
  /** Once after mount, then after every completed pan, zoom or inertia glide. */
  onViewportChange(viewport: Viewport): void;
  /** A valid single map click, after the double-click arbitration window. */
  onEmptyClick(point: LatLng): void;
};

/** Application click arbitration window; not a claim about the OS double-click setting. */
export const MAP_CLICK_DELAY_MS = 500;

/** Bridges map events and cancels pending draft placement on competing interactions. */
export function MapEvents({ onViewportChange, onEmptyClick }: MapEventsProps) {
  const map = useMap();
  const clickTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelClick = useCallback(() => {
    if (clickTimer.current !== null) clearTimeout(clickTimer.current);
    clickTimer.current = null;
  }, []);
  useMapEvents({
    moveend: () => onViewportChange(boundsToViewport(map.getBounds())),
    movestart: cancelClick,
    dblclick: cancelClick,
    click: (event) => {
      cancelClick();
      const { lat, lng } = event.latlng;
      // maxBounds limits panning, not every pixel in a wide container.
      if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) return;
      if (event.originalEvent.detail > 1) return;
      clickTimer.current = setTimeout(() => {
        clickTimer.current = null;
        onEmptyClick({ lat, lng });
      }, MAP_CLICK_DELAY_MS);
    },
  });

  // A later marker/panel interaction must not be overwritten by the delayed
  // map click. Capture phase also cancels before a second map click arrives.
  useEffect(() => {
    document.addEventListener("pointerdown", cancelClick, true);
    document.addEventListener("keydown", cancelClick, true);
    return () => {
      document.removeEventListener("pointerdown", cancelClick, true);
      document.removeEventListener("keydown", cancelClick, true);
      cancelClick();
    };
  }, [cancelClick, onEmptyClick]);

  // The initial report runs once per map instance. A ref holds the latest
  // callback so a new prop identity does not repeat the initial report.
  const latestViewportChange = useRef(onViewportChange);
  useEffect(() => {
    latestViewportChange.current = onViewportChange;
  }, [onViewportChange]);
  useEffect(() => {
    latestViewportChange.current(boundsToViewport(map.getBounds()));
  }, [map]);

  return null;
}
