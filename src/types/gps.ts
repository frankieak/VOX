export interface LatLng {
  lat: number;
  lng: number;
}

export interface FavoriteLocation {
  id: string;
  name: string;
  subtitle?: string;
  lat: number;
  lng: number;
  createdAt: number;
}

export interface RouteWaypoint {
  id: string;
  lat: number;
  lng: number;
  label?: string;
}

export type MapStyle = "dark" | "standard" | "satellite";

export type ActiveTab = "teleport" | "routes" | "favorites";

export type SpeedPresetId = "walk" | "bike" | "car" | "custom";

export interface SearchResult {
  displayName: string;
  lat: number;
  lng: number;
}
