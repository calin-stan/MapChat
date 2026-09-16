import type { LatLng } from "@/lib/map/viewport";

/** Cluj-Napoca; the world view is centred here (spec §3). */
export const DEFAULT_CENTER: LatLng = { lat: 46.7712, lng: 23.6236 };
export const WORLD_ZOOM = 2;
/** Used by chunk 12 for `/room/<id>`. */
export const ROOM_ZOOM = 16;
/** OSM raster limits; zoom 2 shows the whole world. */
export const MIN_ZOOM = 2;
export const MAX_ZOOM = 19;
