import { useEffect, useRef } from "react";
import L from "leaflet";
import type { LatLng, MapStyle, RouteWaypoint } from "@/types/gps";

interface MapCanvasProps {
  position: LatLng;
  accuracyMeters: number;
  bearing: number;
  isSimulatingRoute: boolean;
  isRouteEditMode: boolean;
  followMarker: boolean;
  mapStyle: MapStyle;
  waypoints: RouteWaypoint[];
  flyToTrigger: number;
  onMapClick: (coords: LatLng) => void;
  onMarkerDrag: (coords: LatLng) => void;
}

const TILE_LAYERS: Record<
  MapStyle,
  { url: string; attribution: string; maxZoom: number }
> = {
  dark: {
    url: "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/">CARTO</a>',
    maxZoom: 20,
  },
  standard: {
    url: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    maxZoom: 19,
  },
  satellite: {
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    attribution:
      "Tiles &copy; Esri &mdash; Source: Esri, Maxar, Earthstar Geographics",
    maxZoom: 19,
  },
};

function createVoyPinIcon(bearing: number, isActive: boolean): L.DivIcon {
  const pulseRing = isActive
    ? `<span style="position:absolute;inset:-6px;border-radius:9999px;border:2px solid rgba(74,222,128,0.65);animation:ping 1.5s cubic-bezier(0,0,0.2,1) infinite;"></span>`
    : "";

  return L.divIcon({
    className: "voy-custom-marker",
    iconSize: [44, 52],
    iconAnchor: [22, 48],
    html: `
      <div style="position:relative;width:44px;height:52px;display:flex;align-items:center;justify-content:center;">
        ${pulseRing}
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" width="44" height="44" style="filter:drop-shadow(0 6px 12px rgba(0,0,0,0.6));transform:rotate(${Math.round(
          bearing
        )}deg);transform-origin:24px 20px;transition:transform 150ms linear;">
          <path d="M24 46C24 46 9 30.2 9 19a15 15 0 0 1 30 0c0 11.2-15 27-15 27z" fill="#16A34A" stroke="#ecfdf5" stroke-width="1.5"/>
          <ellipse cx="24" cy="15.2" rx="10.5" ry="2.4" fill="#0A0F0D"/>
          <path d="M17.6 15.2C17.6 9.6 20 7.6 24 7.6s6.4 2 6.4 7.6z" fill="#0A0F0D"/>
        </svg>
      </div>
    `,
  });
}

function createWaypointIcon(index: number): L.DivIcon {
  return L.divIcon({
    className: "voy-custom-marker",
    iconSize: [26, 26],
    iconAnchor: [13, 13],
    html: `
      <div style="width:26px;height:26px;border-radius:9999px;background:#0a0f0d;border:2px solid #22c55e;color:#ecfdf5;font-size:11px;font-weight:700;display:flex;align-items:center;justify-content:center;box-shadow:0 2px 8px rgba(0,0,0,0.5);">
        ${index + 1}
      </div>
    `,
  });
}

export function MapCanvas({
  position,
  accuracyMeters,
  bearing,
  isSimulatingRoute,
  isRouteEditMode,
  followMarker,
  mapStyle,
  waypoints,
  flyToTrigger,
  onMapClick,
  onMarkerDrag,
}: MapCanvasProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const tileLayerRef = useRef<L.TileLayer | null>(null);
  const markerRef = useRef<L.Marker | null>(null);
  const accuracyCircleRef = useRef<L.Circle | null>(null);
  const routePolylineRef = useRef<L.Polyline | null>(null);
  const waypointLayerRef = useRef<L.LayerGroup | null>(null);

  const onMapClickRef = useRef(onMapClick);
  onMapClickRef.current = onMapClick;
  const onMarkerDragRef = useRef(onMarkerDrag);
  onMarkerDragRef.current = onMarkerDrag;

  // Initialize Leaflet map once
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = L.map(containerRef.current, {
      center: [position.lat, position.lng],
      zoom: 15,
      zoomControl: false,
    });

    L.control.zoom({ position: "bottomright" }).addTo(map);

    const tileCfg = TILE_LAYERS[mapStyle];
    const tileLayer = L.tileLayer(tileCfg.url, {
      attribution: tileCfg.attribution,
      maxZoom: tileCfg.maxZoom,
    }).addTo(map);

    const accuracyCircle = L.circle([position.lat, position.lng], {
      radius: accuracyMeters,
      color: "#22c55e",
      fillColor: "#16a34a",
      fillOpacity: 0.14,
      weight: 1.5,
      interactive: false,
    }).addTo(map);

    const marker = L.marker([position.lat, position.lng], {
      icon: createVoyPinIcon(0, false),
      draggable: true,
      zIndexOffset: 500,
    }).addTo(map);

    marker.on("dragend", () => {
      const next = marker.getLatLng();
      onMarkerDragRef.current({ lat: next.lat, lng: next.lng });
    });

    map.on("click", (ev: L.LeafletMouseEvent) => {
      onMapClickRef.current({ lat: ev.latlng.lat, lng: ev.latlng.lng });
    });

    const waypointLayer = L.layerGroup().addTo(map);
    const polyline = L.polyline([], {
      color: "#22c55e",
      weight: 3.5,
      opacity: 0.85,
      dashArray: "8 6",
    }).addTo(map);

    mapRef.current = map;
    tileLayerRef.current = tileLayer;
    accuracyCircleRef.current = accuracyCircle;
    markerRef.current = marker;
    waypointLayerRef.current = waypointLayer;
    routePolylineRef.current = polyline;

    return () => {
      map.remove();
      mapRef.current = null;
      tileLayerRef.current = null;
      accuracyCircleRef.current = null;
      markerRef.current = null;
      waypointLayerRef.current = null;
      routePolylineRef.current = null;
    };
  }, []);

  // Switch tile layer when mapStyle changes
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (tileLayerRef.current) {
      map.removeLayer(tileLayerRef.current);
    }
    const tileCfg = TILE_LAYERS[mapStyle];
    tileLayerRef.current = L.tileLayer(tileCfg.url, {
      attribution: tileCfg.attribution,
      maxZoom: tileCfg.maxZoom,
    }).addTo(map);
  }, [mapStyle]);

  // Update simulated GPS marker & accuracy circle
  useEffect(() => {
    const map = mapRef.current;
    const marker = markerRef.current;
    const circle = accuracyCircleRef.current;
    if (!map || !marker || !circle) return;

    marker.setLatLng([position.lat, position.lng]);
    marker.setIcon(
      createVoyPinIcon(isSimulatingRoute ? bearing : 0, isSimulatingRoute)
    );

    if (isSimulatingRoute) {
      marker.dragging?.disable();
    } else {
      marker.dragging?.enable();
    }

    circle.setLatLng([position.lat, position.lng]);
    circle.setRadius(accuracyMeters);

    if (followMarker) {
      map.panTo([position.lat, position.lng], { animate: true, duration: 0.25 });
    }
  }, [position, accuracyMeters, bearing, isSimulatingRoute, followMarker]);

  // Explicit fly-to trigger (e.g. search, favorite jump, center button)
  useEffect(() => {
    const map = mapRef.current;
    if (!map || flyToTrigger === 0) return;
    map.flyTo([position.lat, position.lng], Math.max(map.getZoom(), 15), {
      duration: 0.6,
    });
  }, [flyToTrigger]);

  // Update route polyline and waypoints
  useEffect(() => {
    const polyline = routePolylineRef.current;
    const layerGroup = waypointLayerRef.current;
    if (!polyline || !layerGroup) return;

    polyline.setLatLngs(waypoints.map((wp) => [wp.lat, wp.lng]));
    layerGroup.clearLayers();

    waypoints.forEach((wp, idx) => {
      L.marker([wp.lat, wp.lng], {
        icon: createWaypointIcon(idx),
        interactive: false,
      }).addTo(layerGroup);
    });
  }, [waypoints]);

  return (
    <div
      ref={containerRef}
      className={
        isRouteEditMode
          ? "h-full w-full cursor-crosshair"
          : "h-full w-full cursor-grab active:cursor-grabbing"
      }
      aria-label="Mapa interactivo de simulación GPS"
    />
  );
}
