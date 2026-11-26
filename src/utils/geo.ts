import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import type { LatLng, RouteWaypoint } from "@/types/gps";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const EARTH_RADIUS_M = 6371000;

export function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

export function toDeg(rad: number): number {
  return (rad * 180) / Math.PI;
}

/** Distance in meters between two coordinates */
export function haversineDistance(a: LatLng, b: LatLng): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);

  const sinDLat = Math.sin(dLat / 2);
  const sinDLng = Math.sin(dLng / 2);

  const h =
    sinDLat * sinDLat +
    Math.cos(lat1) * Math.cos(lat2) * sinDLng * sinDLng;
  return 2 * EARTH_RADIUS_M * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

/** Initial bearing in degrees (0..360) from a to b */
export function calculateBearing(a: LatLng, b: LatLng): number {
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const dLng = toRad(b.lng - a.lng);

  const y = Math.sin(dLng) * Math.cos(lat2);
  const x =
    Math.cos(lat1) * Math.sin(lat2) -
    Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

export function totalRouteDistance(waypoints: RouteWaypoint[]): number {
  if (waypoints.length < 2) return 0;
  let total = 0;
  for (let i = 1; i < waypoints.length; i++) {
    total += haversineDistance(waypoints[i - 1], waypoints[i]);
  }
  return total;
}

export function interpolateLatLng(a: LatLng, b: LatLng, t: number): LatLng {
  const clamped = Math.max(0, Math.min(1, t));
  return {
    lat: a.lat + (b.lat - a.lat) * clamped,
    lng: a.lng + (b.lng - a.lng) * clamped,
  };
}

/** Offset a coordinate by meters north/east */
export function offsetCoordinates(
  origin: LatLng,
  northMeters: number,
  eastMeters: number
): LatLng {
  const dLat = northMeters / EARTH_RADIUS_M;
  const dLng =
    eastMeters / (EARTH_RADIUS_M * Math.cos(toRad(origin.lat)));
  return {
    lat: Math.max(-85, Math.min(85, origin.lat + toDeg(dLat))),
    lng: ((origin.lng + toDeg(dLng) + 540) % 360) - 180,
  };
}

export function formatDistance(meters: number): string {
  if (meters < 1000) {
    return `${Math.round(meters)} m`;
  }
  return `${(meters / 1000).toFixed(2)} km`;
}

export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "0s";
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.round(seconds % 60);
  if (hrs > 0) return `${hrs}h ${mins}m`;
  if (mins > 0) return `${mins}m ${secs}s`;
  return `${secs}s`;
}

export function buildGpxDocument(waypoints: RouteWaypoint[], name = "Ruta VOY"): string {
  const points = waypoints
    .map(
      (wp, idx) =>
        `      <trkpt lat="${wp.lat.toFixed(6)}" lon="${wp.lng.toFixed(6)}">\n        <name>${wp.label ?? `Punto ${idx + 1}`}</name>\n      </trkpt>`
    )
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="VOY Simulador GPS" xmlns="http://www.topografix.com/GPX/1/1">
  <trk>
    <name>${name}</name>
    <trkseg>
${points}
    </trkseg>
  </trk>
</gpx>
`;
}
