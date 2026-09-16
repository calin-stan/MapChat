import { divIcon, type DivIcon } from "leaflet";

export type PinVariant = "room" | "selected" | "draft";

type PinSpec = { width: number; height: number; fill: string; opacity: number; dot: boolean };

const SPECS: Record<PinVariant, PinSpec> = {
  room: { width: 24, height: 36, fill: "#2563eb", opacity: 1, dot: true },
  selected: { width: 28, height: 42, fill: "#f59e0b", opacity: 1, dot: true },
  draft: { width: 24, height: 36, fill: "#6b7280", opacity: 0.7, dot: false },
};

/** Inline SVG for one pin: a classic marker drawn in a 24 × 36 box, scaled to the variant's size. */
export function pinSvg(variant: PinVariant): string {
  const { width, height, fill, opacity, dot } = SPECS[variant];
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 24 36" style="opacity:${opacity}">` +
    `<path d="M12 0C5.4 0 0 5.4 0 12c0 9 12 24 12 24s12-15 12-24C24 5.4 18.6 0 12 0z" fill="${fill}" stroke="#ffffff" stroke-width="1.5"/>` +
    (dot ? `<circle cx="12" cy="12" r="4.5" fill="#ffffff"/>` : "") +
    `</svg>`
  );
}

const cache = new Map<PinVariant, DivIcon>();

/**
 * One shared `DivIcon` per variant, anchored at the tip. The class replaces
 * Leaflet's default `leaflet-div-icon`, so no white box is drawn, and it
 * carries no styles of its own. Using `divIcon` avoids Leaflet's broken
 * default PNG paths under bundlers (spec §4).
 */
export function pinIcon(variant: PinVariant): DivIcon {
  let icon = cache.get(variant);
  if (icon === undefined) {
    const { width, height } = SPECS[variant];
    icon = divIcon({
      html: pinSvg(variant),
      className: `map-pin map-pin-${variant}`,
      iconSize: [width, height],
      iconAnchor: [width / 2, height],
    });
    cache.set(variant, icon);
  }
  return icon;
}
