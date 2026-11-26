import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Bookmark,
  Check,
  Compass,
  Copy,
  Crosshair,
  Download,
  Layers,
  LocateFixed,
  MapPin,
  Navigation,
  Pause,
  Play,
  Plus,
  Repeat,
  RotateCcw,
  Route,
  Search,
  SlidersHorizontal,
  Square,
  Star,
  Trash2,
  X,
} from "lucide-react";
import { MapCanvas } from "@/components/MapCanvas";
import { VoyLogo } from "@/components/VoyLogo";
import type {
  ActiveTab,
  FavoriteLocation,
  LatLng,
  MapStyle,
  RouteWaypoint,
  SearchResult,
  SpeedPresetId,
} from "@/types/gps";
import {
  buildGpxDocument,
  calculateBearing,
  cn,
  formatDistance,
  formatDuration,
  haversineDistance,
  interpolateLatLng,
  offsetCoordinates,
  totalRouteDistance,
} from "@/utils/geo";

const STORAGE_FAVORITES_KEY = "voy_gps_favorites_v1";
const STORAGE_POSITION_KEY = "voy_gps_last_pos_v1";

const DEFAULT_POSITION: LatLng = { lat: 40.416775, lng: -3.70379 }; // Puerta del Sol, Madrid

const STARTER_FAVORITES: FavoriteLocation[] = [
  {
    id: "fav-madrid",
    name: "Puerta del Sol, Madrid",
    subtitle: "España",
    lat: 40.416775,
    lng: -3.70379,
    createdAt: 1,
  },
  {
    id: "fav-cdmx",
    name: "Zócalo, Ciudad de México",
    subtitle: "México",
    lat: 19.432608,
    lng: -99.133209,
    createdAt: 2,
  },
  {
    id: "fav-ba",
    name: "Obelisco, Buenos Aires",
    subtitle: "Argentina",
    lat: -34.603739,
    lng: -58.38157,
    createdAt: 3,
  },
  {
    id: "fav-tokyo",
    name: "Cruce de Shibuya, Tokio",
    subtitle: "Japón",
    lat: 35.659494,
    lng: 139.700553,
    createdAt: 4,
  },
];

const SPEED_PRESETS: Record<
  SpeedPresetId,
  { label: string; kmh: number }
> = {
  walk: { label: "Caminar", kmh: 5 },
  bike: { label: "Bici", kmh: 18 },
  car: { label: "Auto", kmh: 50 },
  custom: { label: "Libre", kmh: 90 },
};

function loadSavedPosition(): LatLng {
  try {
    const raw = localStorage.getItem(STORAGE_POSITION_KEY);
    if (!raw) return DEFAULT_POSITION;
    const parsed = JSON.parse(raw) as Partial<LatLng>;
    if (
      typeof parsed.lat === "number" &&
      typeof parsed.lng === "number" &&
      Number.isFinite(parsed.lat) &&
      Number.isFinite(parsed.lng)
    ) {
      return { lat: parsed.lat, lng: parsed.lng };
    }
  } catch {
    // Ignore storage read errors
  }
  return DEFAULT_POSITION;
}

function loadSavedFavorites(): FavoriteLocation[] {
  try {
    const raw = localStorage.getItem(STORAGE_FAVORITES_KEY);
    if (!raw) return STARTER_FAVORITES;
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed;
  } catch {
    // Ignore storage read errors
  }
  return STARTER_FAVORITES;
}

function parseCoordinateInput(input: string): LatLng | null {
  const match = input
    .trim()
    .match(/^(-?\d{1,2}(?:\.\d+)?)\s*[,;\s]\s*(-?\d{1,3}(?:\.\d+)?)$/);
  if (!match) return null;
  const lat = Number(match[1]);
  const lng = Number(match[2]);
  if (
    !Number.isFinite(lat) ||
    !Number.isFinite(lng) ||
    lat < -90 ||
    lat > 90 ||
    lng < -180 ||
    lng > 180
  ) {
    return null;
  }
  return { lat, lng };
}

export function App() {
  const [position, setPosition] = useState<LatLng>(loadSavedPosition);
  const [accuracyMeters, setAccuracyMeters] = useState<number>(12);
  const [bearing, setBearing] = useState<number>(0);
  const [activeTab, setActiveTab] = useState<ActiveTab>("teleport");
  const [mapStyle, setMapStyle] = useState<MapStyle>("dark");
  const [followMarker, setFollowMarker] = useState<boolean>(true);
  const [flyToTrigger, setFlyToTrigger] = useState<number>(0);
  const [mobilePanelOpen, setMobilePanelOpen] = useState<boolean>(true);

  // Search & Coordinate entry
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState<boolean>(false);
  const [searchNotice, setSearchNotice] = useState<string | null>(null);

  // Favorites
  const [favorites, setFavorites] = useState<FavoriteLocation[]>(
    loadSavedFavorites
  );
  const [newFavoriteName, setNewFavoriteName] = useState<string>("");
  const [showSaveFavoriteForm, setShowSaveFavoriteForm] =
    useState<boolean>(false);

  // Joystick / Speed / Route Simulation
  const [speedPreset, setSpeedPreset] = useState<SpeedPresetId>("walk");
  const [speedKmh, setSpeedKmh] = useState<number>(5);
  const [joystickStepMeters, setJoystickStepMeters] = useState<number>(25);

  const [waypoints, setWaypoints] = useState<RouteWaypoint[]>([]);
  const [isAddingWaypoints, setIsAddingWaypoints] = useState<boolean>(false);
  const [isSimulatingRoute, setIsSimulatingRoute] = useState<boolean>(false);
  const [loopRoute, setLoopRoute] = useState<boolean>(false);
  const [routeProgressPct, setRouteProgressPct] = useState<number>(0);

  // Copy feedback
  const [copiedCoords, setCopiedCoords] = useState<boolean>(false);

  // Persist position & favorites
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_POSITION_KEY, JSON.stringify(position));
    } catch {
      // Ignore quota errors
    }
  }, [position]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_FAVORITES_KEY, JSON.stringify(favorites));
    } catch {
      // Ignore quota errors
    }
  }, [favorites]);

  const routeDistanceMeters = useMemo(
    () => totalRouteDistance(waypoints),
    [waypoints]
  );

  const estimatedSeconds = useMemo(() => {
    if (routeDistanceMeters <= 0 || speedKmh <= 0) return 0;
    return routeDistanceMeters / (speedKmh / 3.6);
  }, [routeDistanceMeters, speedKmh]);

  // Route playback engine
  const simStateRef = useRef({
    segmentIndex: 0,
    segmentProgress: 0,
    lastTick: 0,
  });

  useEffect(() => {
    if (!isSimulatingRoute || waypoints.length < 2) return;

    simStateRef.current.lastTick = performance.now();
    let rafId = 0;

    const tick = (now: number) => {
      const dtSec = Math.min(0.2, (now - simStateRef.current.lastTick) / 1000);
      simStateRef.current.lastTick = now;

      const speedMps = Math.max(0.5, speedKmh / 3.6);
      let idx = simStateRef.current.segmentIndex;
      let progress = simStateRef.current.segmentProgress;

      if (idx >= waypoints.length - 1) {
        if (loopRoute) {
          idx = 0;
          progress = 0;
        } else {
          setIsSimulatingRoute(false);
          setRouteProgressPct(100);
          return;
        }
      }

      const start = waypoints[idx];
      const end = waypoints[idx + 1];
      const segLen = Math.max(1, haversineDistance(start, end));
      const deltaProgress = (speedMps * dtSec) / segLen;
      progress += deltaProgress;

      while (progress >= 1 && idx < waypoints.length - 1) {
        progress -= 1;
        idx += 1;
        if (idx >= waypoints.length - 1) {
          if (loopRoute) {
            idx = 0;
          } else {
            const finalPos = waypoints[waypoints.length - 1];
            setPosition({ lat: finalPos.lat, lng: finalPos.lng });
            setRouteProgressPct(100);
            setIsSimulatingRoute(false);
            return;
          }
        }
      }

      simStateRef.current.segmentIndex = idx;
      simStateRef.current.segmentProgress = progress;

      const curStart = waypoints[idx];
      const curEnd = waypoints[idx + 1];
      const nextPos = interpolateLatLng(curStart, curEnd, progress);
      const nextBearing = calculateBearing(curStart, curEnd);

      setPosition(nextPos);
      setBearing(nextBearing);

      if (routeDistanceMeters > 0) {
        let covered = 0;
        for (let i = 0; i < idx; i++) {
          covered += haversineDistance(waypoints[i], waypoints[i + 1]);
        }
        covered += haversineDistance(curStart, curEnd) * progress;
        setRouteProgressPct(
          Math.min(100, Math.round((covered / routeDistanceMeters) * 100))
        );
      }

      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [isSimulatingRoute, waypoints, speedKmh, loopRoute, routeDistanceMeters]);

  const jumpToLocation = useCallback((coords: LatLng) => {
    setIsSimulatingRoute(false);
    setPosition(coords);
    setFlyToTrigger((prev) => prev + 1);
  }, []);

  const handleMapClick = useCallback(
    (coords: LatLng) => {
      if (activeTab === "routes" && isAddingWaypoints) {
        setWaypoints((prev) => [
          ...prev,
          {
            id: `wp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            lat: coords.lat,
            lng: coords.lng,
            label: `Punto ${prev.length + 1}`,
          },
        ]);
      } else if (!isSimulatingRoute) {
        setPosition(coords);
      }
    },
    [activeTab, isAddingWaypoints, isSimulatingRoute]
  );

  const handleNudge = (northMeters: number, eastMeters: number) => {
    if (isSimulatingRoute) return;
    const next = offsetCoordinates(position, northMeters, eastMeters);
    setBearing(calculateBearing(position, next));
    setPosition(next);
  };

  const handleSelectSpeedPreset = (preset: SpeedPresetId) => {
    setSpeedPreset(preset);
    setSpeedKmh(SPEED_PRESETS[preset].kmh);
  };

  const handleStartRoute = () => {
    if (waypoints.length < 2) return;
    if (!isSimulatingRoute) {
      if (routeProgressPct >= 99 || simStateRef.current.segmentIndex >= waypoints.length - 1) {
        simStateRef.current.segmentIndex = 0;
        simStateRef.current.segmentProgress = 0;
        setRouteProgressPct(0);
        setPosition({ lat: waypoints[0].lat, lng: waypoints[0].lng });
      }
      setFollowMarker(true);
      setIsAddingWaypoints(false);
      setIsSimulatingRoute(true);
    } else {
      setIsSimulatingRoute(false);
    }
  };

  const handleStopRoute = () => {
    setIsSimulatingRoute(false);
    simStateRef.current.segmentIndex = 0;
    simStateRef.current.segmentProgress = 0;
    setRouteProgressPct(0);
    if (waypoints.length > 0) {
      jumpToLocation({ lat: waypoints[0].lat, lng: waypoints[0].lng });
    }
  };

  const handleExportGpx = () => {
    if (waypoints.length === 0) return;
    const gpx = buildGpxDocument(waypoints, "Ruta VOY GPS");
    const blob = new Blob([gpx], { type: "application/gpx+xml" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `voy-ruta-${new Date().toISOString().slice(0, 10)}.gpx`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleSearchSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = searchQuery.trim();
    if (!trimmed) return;

    setSearchNotice(null);
    const directCoords = parseCoordinateInput(trimmed);
    if (directCoords) {
      setSearchResults([]);
      jumpToLocation(directCoords);
      return;
    }

    setIsSearching(true);
    try {
      const response = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&limit=5&q=${encodeURIComponent(
          trimmed
        )}`,
        {
          headers: { Accept: "application/json" },
        }
      );
      if (!response.ok) {
        throw new Error("Search request failed");
      }
      const data = (await response.json()) as Array<{
        display_name: string;
        lat: string;
        lon: string;
      }>;
      const mapped: SearchResult[] = data.map((item) => ({
        displayName: item.display_name,
        lat: Number(item.lat),
        lng: Number(item.lon),
      }));
      setSearchResults(mapped);
      if (mapped.length === 0) {
        setSearchNotice("Sin resultados. Prueba otra dirección o lat, lng.");
      }
    } catch {
      setSearchNotice(
        "No se pudo consultar el buscador. Puedes introducir coordenadas (ej. 40.4168, -3.7038)."
      );
    } finally {
      setIsSearching(false);
    }
  };

  const handleCopyCoords = async () => {
    const text = `${position.lat.toFixed(6)}, ${position.lng.toFixed(6)}`;
    try {
      await navigator.clipboard.writeText(text);
      setCopiedCoords(true);
      setTimeout(() => setCopiedCoords(false), 1800);
    } catch {
      // Clipboard blocked in restricted contexts
    }
  };

  const handleUseRealLocation = () => {
    if (!("geolocation" in navigator)) return;
    navigator.geolocation.getCurrentPosition(
      (geo) => {
        jumpToLocation({
          lat: geo.coords.latitude,
          lng: geo.coords.longitude,
        });
      },
      () => {
        setSearchNotice("Permiso de ubicación real denegado o no disponible.");
      },
      { enableHighAccuracy: true, timeout: 8000 }
    );
  };

  const handleSaveFavorite = (e: React.FormEvent) => {
    e.preventDefault();
    const label = newFavoriteName.trim();
    if (!label) return;
    const item: FavoriteLocation = {
      id: `fav-${Date.now()}`,
      name: label,
      subtitle: `${position.lat.toFixed(4)}, ${position.lng.toFixed(4)}`,
      lat: position.lat,
      lng: position.lng,
      createdAt: Date.now(),
    };
    setFavorites((prev) => [item, ...prev]);
    setNewFavoriteName("");
    setShowSaveFavoriteForm(false);
    setActiveTab("favorites");
  };

  const cycleMapStyle = () => {
    setMapStyle((prev) =>
      prev === "dark" ? "standard" : prev === "standard" ? "satellite" : "dark"
    );
  };

  const mapStyleLabel =
    mapStyle === "dark"
      ? "Oscuro"
      : mapStyle === "standard"
      ? "Estándar"
      : "Satélite";

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-[#0a0f0d] text-emerald-50">
      {/* Fullscreen Interactive Map */}
      <div className="absolute inset-0 z-0">
        <MapCanvas
          position={position}
          accuracyMeters={accuracyMeters}
          bearing={bearing}
          isSimulatingRoute={isSimulatingRoute}
          isRouteEditMode={activeTab === "routes" && isAddingWaypoints}
          followMarker={followMarker}
          mapStyle={mapStyle}
          waypoints={waypoints}
          flyToTrigger={flyToTrigger}
          onMapClick={handleMapClick}
          onMarkerDrag={(coords) => {
            if (!isSimulatingRoute) setPosition(coords);
          }}
        />
      </div>

      {/* Top Floating Search & Quick Actions */}
      <header className="pointer-events-none absolute top-3 right-3 left-3 z-20 flex flex-wrap items-start justify-between gap-3 md:left-[388px]">
        <div className="pointer-events-auto relative w-full max-w-md">
          <form
            onSubmit={handleSearchSubmit}
            className="flex items-center gap-2 rounded-xl border border-emerald-500/20 bg-[#0a0f0d]/90 px-3 py-2 shadow-xl backdrop-blur-md"
          >
            <Search className="h-4 w-4 shrink-0 text-emerald-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Buscar lugar o lat, lng (ej. 40.4168, -3.7038)"
              className="w-full bg-transparent text-sm text-emerald-50 placeholder-emerald-200/45 outline-none"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => {
                  setSearchQuery("");
                  setSearchResults([]);
                  setSearchNotice(null);
                }}
                className="rounded-md p-1 text-emerald-200/60 hover:bg-emerald-500/15 hover:text-emerald-100"
                aria-label="Limpiar búsqueda"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
            <button
              type="submit"
              disabled={isSearching}
              className="shrink-0 rounded-lg bg-[#16a34a] px-3 py-1 text-xs font-semibold text-white transition hover:bg-emerald-500 disabled:opacity-50"
            >
              {isSearching ? "..." : "Ir"}
            </button>
          </form>

          {searchNotice && (
            <div className="mt-1.5 rounded-lg border border-amber-500/30 bg-[#111916]/95 px-3 py-2 text-xs text-amber-200 shadow-lg backdrop-blur-md">
              {searchNotice}
            </div>
          )}

          {searchResults.length > 0 && (
            <ul className="mt-1.5 divide-y divide-emerald-500/10 overflow-hidden rounded-xl border border-emerald-500/20 bg-[#111916]/95 shadow-2xl backdrop-blur-md">
              {searchResults.map((res, index) => (
                <li key={`${res.lat}-${res.lng}-${index}`}>
                  <button
                    type="button"
                    onClick={() => {
                      jumpToLocation({ lat: res.lat, lng: res.lng });
                      setSearchResults([]);
                    }}
                    className="flex w-full items-start gap-2.5 px-3 py-2.5 text-left text-xs transition hover:bg-emerald-500/15"
                  >
                    <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-400" />
                    <span className="line-clamp-2 text-emerald-100">
                      {res.displayName}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Map Right Controls */}
        <div className="pointer-events-auto flex items-center gap-2">
          <button
            type="button"
            onClick={cycleMapStyle}
            className="flex items-center gap-1.5 rounded-xl border border-emerald-500/20 bg-[#0a0f0d]/90 px-3 py-2 text-xs font-medium text-emerald-100 shadow-lg backdrop-blur-md transition hover:border-emerald-400/50 hover:bg-[#111916]"
            title="Cambiar estilo de mapa"
          >
            <Layers className="h-3.5 w-3.5 text-emerald-400" />
            <span>{mapStyleLabel}</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setFollowMarker((prev) => !prev);
              setFlyToTrigger((prev) => prev + 1);
            }}
            className={cn(
              "flex items-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-medium shadow-lg backdrop-blur-md transition",
              followMarker
                ? "border-emerald-500/50 bg-[#16a34a]/25 text-emerald-200"
                : "border-emerald-500/20 bg-[#0a0f0d]/90 text-emerald-200/75 hover:bg-[#111916]"
            )}
            title="Centrar y seguir marcador"
          >
            <LocateFixed className="h-3.5 w-3.5 text-emerald-400" />
            <span className="hidden sm:inline">Seguir</span>
          </button>

          <button
            type="button"
            onClick={handleUseRealLocation}
            className="flex items-center gap-1.5 rounded-xl border border-emerald-500/20 bg-[#0a0f0d]/90 px-3 py-2 text-xs font-medium text-emerald-100 shadow-lg backdrop-blur-md transition hover:border-emerald-400/50 hover:bg-[#111916]"
            title="Ir a mi ubicación real"
          >
            <Crosshair className="h-3.5 w-3.5 text-emerald-400" />
            <span className="hidden sm:inline">Mi GPS</span>
          </button>

          <button
            type="button"
            onClick={() => setMobilePanelOpen((v) => !v)}
            className="flex items-center gap-1.5 rounded-xl border border-emerald-500/20 bg-[#0a0f0d]/90 px-3 py-2 text-xs font-medium text-emerald-100 shadow-lg backdrop-blur-md md:hidden"
          >
            <SlidersHorizontal className="h-3.5 w-3.5 text-emerald-400" />
            <span>{mobilePanelOpen ? "Ocultar" : "Panel"}</span>
          </button>
        </div>
      </header>

      {/* Main Left Control Panel */}
      <aside
        className={cn(
          "absolute bottom-3 left-3 z-20 flex w-[calc(100vw-24px)] max-w-[360px] flex-col overflow-hidden rounded-2xl border border-emerald-500/20 bg-[#0a0f0d]/92 shadow-2xl backdrop-blur-xl transition-transform duration-200 md:top-3 md:bottom-3",
          mobilePanelOpen
            ? "max-h-[68vh] translate-y-0 md:max-h-none"
            : "pointer-events-none translate-y-[110%] md:pointer-events-auto md:translate-y-0"
        )}
      >
        {/* Brand Header */}
        <div className="flex items-center justify-between border-b border-emerald-500/15 px-4 py-3">
          <div className="flex items-center gap-2.5">
            <VoyLogo className="h-8 w-8 shrink-0" />
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-base font-bold tracking-tight text-white">
                  VOY
                </h1>
                <span className="rounded-md bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-emerald-400 uppercase">
                  Simulador GPS
                </span>
              </div>
              <p className="text-[11px] text-emerald-200/60">
                Ubicación, rutas y favoritos · Sin publicidad
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setMobilePanelOpen(false)}
            className="rounded-lg p-1.5 text-emerald-200/60 hover:bg-emerald-500/15 hover:text-white md:hidden"
            aria-label="Minimizar panel"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Live Telemetry Summary */}
        <div className="border-b border-emerald-500/15 bg-[#111916]/75 px-4 py-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span
                className={cn(
                  "h-2 w-2 rounded-full",
                  isSimulatingRoute
                    ? "animate-pulse bg-emerald-400"
                    : "bg-emerald-500"
                )}
              />
              <span className="text-xs font-semibold text-emerald-100">
                {isSimulatingRoute ? "Ruta en movimiento" : "GPS simulado activo"}
              </span>
            </div>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={handleCopyCoords}
                className="flex items-center gap-1 rounded-md border border-emerald-500/20 bg-emerald-500/10 px-2 py-1 text-[11px] font-medium text-emerald-200 transition hover:bg-emerald-500/20"
                title="Copiar coordenadas"
              >
                {copiedCoords ? (
                  <>
                    <Check className="h-3 w-3 text-emerald-400" />
                    <span>Copiado</span>
                  </>
                ) : (
                  <>
                    <Copy className="h-3 w-3" />
                    <span>Copiar</span>
                  </>
                )}
              </button>
              <button
                type="button"
                onClick={() => setShowSaveFavoriteForm((v) => !v)}
                className="flex items-center gap-1 rounded-md border border-emerald-500/20 bg-emerald-500/10 px-2 py-1 text-[11px] font-medium text-emerald-200 transition hover:bg-emerald-500/20"
                title="Guardar en favoritos"
              >
                <Star className="h-3 w-3 text-amber-400" />
                <span>Guardar</span>
              </button>
            </div>
          </div>

          <div className="mt-2.5 grid grid-cols-2 gap-2 text-xs">
            <div className="rounded-lg bg-[#0a0f0d]/80 px-2.5 py-1.5">
              <span className="block text-[10px] text-emerald-200/50">
                Latitud
              </span>
              <span className="font-mono font-medium text-emerald-50">
                {position.lat.toFixed(6)}
              </span>
            </div>
            <div className="rounded-lg bg-[#0a0f0d]/80 px-2.5 py-1.5">
              <span className="block text-[10px] text-emerald-200/50">
                Longitud
              </span>
              <span className="font-mono font-medium text-emerald-50">
                {position.lng.toFixed(6)}
              </span>
            </div>
          </div>

          <div className="mt-2 flex items-center justify-between text-[11px] text-emerald-200/70">
            <span className="flex items-center gap-1">
              <Compass className="h-3 w-3 text-emerald-400" />
              Rumbo: {Math.round(bearing)}°
            </span>
            <span>
              Velocidad: {isSimulatingRoute ? `${speedKmh} km/h` : "0 km/h"}
            </span>
            <span>±{accuracyMeters} m</span>
          </div>

          {showSaveFavoriteForm && (
            <form
              onSubmit={handleSaveFavorite}
              className="mt-2.5 flex items-center gap-1.5"
            >
              <input
                type="text"
                value={newFavoriteName}
                onChange={(e) => setNewFavoriteName(e.target.value)}
                placeholder="Nombre del favorito..."
                autoFocus
                className="w-full rounded-lg border border-emerald-500/30 bg-[#0a0f0d] px-2.5 py-1.5 text-xs text-white placeholder-emerald-200/40 outline-none focus:border-emerald-400"
              />
              <button
                type="submit"
                className="shrink-0 rounded-lg bg-[#16a34a] px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500"
              >
                Añadir
              </button>
            </form>
          )}
        </div>

        {/* Navigation Tabs */}
        <nav className="grid grid-cols-3 border-b border-emerald-500/15 bg-[#0d1411]">
          <button
            type="button"
            onClick={() => setActiveTab("teleport")}
            className={cn(
              "flex items-center justify-center gap-1.5 py-2.5 text-xs font-semibold transition",
              activeTab === "teleport"
                ? "border-b-2 border-[#16a34a] bg-emerald-500/10 text-emerald-300"
                : "text-emerald-200/60 hover:text-emerald-100"
            )}
          >
            <Navigation className="h-3.5 w-3.5" />
            <span>Ubicación</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("routes")}
            className={cn(
              "flex items-center justify-center gap-1.5 py-2.5 text-xs font-semibold transition",
              activeTab === "routes"
                ? "border-b-2 border-[#16a34a] bg-emerald-500/10 text-emerald-300"
                : "text-emerald-200/60 hover:text-emerald-100"
            )}
          >
            <Route className="h-3.5 w-3.5" />
            <span>Rutas ({waypoints.length})</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("favorites")}
            className={cn(
              "flex items-center justify-center gap-1.5 py-2.5 text-xs font-semibold transition",
              activeTab === "favorites"
                ? "border-b-2 border-[#16a34a] bg-emerald-500/10 text-emerald-300"
                : "text-emerald-200/60 hover:text-emerald-100"
            )}
          >
            <Bookmark className="h-3.5 w-3.5" />
            <span>Favoritos</span>
          </button>
        </nav>

        {/* Tab Body */}
        <div className="flex-1 overflow-y-auto p-4">
          {activeTab === "teleport" && (
            <div className="space-y-4">
              <div className="rounded-xl border border-emerald-500/15 bg-[#111916] p-3">
                <p className="text-xs leading-relaxed text-emerald-100/80">
                  Haz clic en cualquier punto del mapa o arrastra el pin verde
                  de <strong className="text-emerald-300">VOY</strong> para
                  teletransportar la ubicación GPS al instante.
                </p>
              </div>

              {/* Virtual Joystick */}
              <div className="rounded-xl border border-emerald-500/15 bg-[#111916] p-3.5">
                <div className="mb-3 flex items-center justify-between">
                  <span className="text-xs font-semibold text-emerald-100">
                    Joystick de desplazamiento
                  </span>
                  <span className="font-mono text-[11px] text-emerald-400">
                    Paso: {joystickStepMeters} m
                  </span>
                </div>

                <div className="mx-auto grid w-40 grid-cols-3 gap-1.5">
                  <div />
                  <button
                    type="button"
                    onClick={() => handleNudge(joystickStepMeters, 0)}
                    disabled={isSimulatingRoute}
                    className="flex h-11 items-center justify-center rounded-xl border border-emerald-500/25 bg-[#0a0f0d] text-emerald-200 transition hover:border-emerald-400 hover:bg-emerald-500/20 disabled:opacity-40"
                    aria-label="Mover al norte"
                  >
                    <ArrowUp className="h-4 w-4" />
                  </button>
                  <div />

                  <button
                    type="button"
                    onClick={() => handleNudge(0, -joystickStepMeters)}
                    disabled={isSimulatingRoute}
                    className="flex h-11 items-center justify-center rounded-xl border border-emerald-500/25 bg-[#0a0f0d] text-emerald-200 transition hover:border-emerald-400 hover:bg-emerald-500/20 disabled:opacity-40"
                    aria-label="Mover al oeste"
                  >
                    <ArrowLeft className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setFlyToTrigger((v) => v + 1)}
                    className="flex h-11 items-center justify-center rounded-xl border border-emerald-500/25 bg-[#16a34a]/20 text-emerald-300 transition hover:bg-[#16a34a]/35"
                    title="Centrar mapa"
                  >
                    <Crosshair className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleNudge(0, joystickStepMeters)}
                    disabled={isSimulatingRoute}
                    className="flex h-11 items-center justify-center rounded-xl border border-emerald-500/25 bg-[#0a0f0d] text-emerald-200 transition hover:border-emerald-400 hover:bg-emerald-500/20 disabled:opacity-40"
                    aria-label="Mover al este"
                  >
                    <ArrowRight className="h-4 w-4" />
                  </button>

                  <div />
                  <button
                    type="button"
                    onClick={() => handleNudge(-joystickStepMeters, 0)}
                    disabled={isSimulatingRoute}
                    className="flex h-11 items-center justify-center rounded-xl border border-emerald-500/25 bg-[#0a0f0d] text-emerald-200 transition hover:border-emerald-400 hover:bg-emerald-500/20 disabled:opacity-40"
                    aria-label="Mover al sur"
                  >
                    <ArrowDown className="h-4 w-4" />
                  </button>
                  <div />
                </div>

                <div className="mt-3">
                  <label className="mb-1 flex justify-between text-[11px] text-emerald-200/70">
                    <span>Distancia por paso</span>
                    <span>{joystickStepMeters} m</span>
                  </label>
                  <input
                    type="range"
                    min={5}
                    max={250}
                    step={5}
                    value={joystickStepMeters}
                    onChange={(e) =>
                      setJoystickStepMeters(Number(e.target.value))
                    }
                    className="w-full accent-[#16a34a]"
                  />
                </div>
              </div>

              {/* Accuracy Simulation */}
              <div className="rounded-xl border border-emerald-500/15 bg-[#111916] p-3.5">
                <div className="mb-1 flex justify-between text-xs">
                  <span className="font-semibold text-emerald-100">
                    Radio de precisión GPS
                  </span>
                  <span className="font-mono text-emerald-400">
                    ±{accuracyMeters} m
                  </span>
                </div>
                <input
                  type="range"
                  min={3}
                  max={100}
                  step={1}
                  value={accuracyMeters}
                  onChange={(e) => setAccuracyMeters(Number(e.target.value))}
                  className="w-full accent-[#16a34a]"
                />
              </div>
            </div>
          )}

          {activeTab === "routes" && (
            <div className="space-y-3.5">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setIsAddingWaypoints((v) => !v)}
                  className={cn(
                    "flex flex-1 items-center justify-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-semibold transition",
                    isAddingWaypoints
                      ? "border-emerald-400 bg-[#16a34a] text-white"
                      : "border-emerald-500/30 bg-[#111916] text-emerald-200 hover:bg-emerald-500/15"
                  )}
                >
                  <Plus className="h-3.5 w-3.5" />
                  <span>
                    {isAddingWaypoints
                      ? "Toca el mapa (Activo)"
                      : "Añadir puntos en mapa"}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setWaypoints((prev) => [
                      ...prev,
                      {
                        id: `wp-${Date.now()}`,
                        lat: position.lat,
                        lng: position.lng,
                        label: `Punto ${prev.length + 1}`,
                      },
                    ]);
                  }}
                  className="rounded-xl border border-emerald-500/25 bg-[#111916] px-2.5 py-2 text-xs font-medium text-emerald-200 hover:bg-emerald-500/15"
                  title="Añadir ubicación actual como punto"
                >
                  + Pin
                </button>
              </div>

              {/* Speed Selection */}
              <div className="rounded-xl border border-emerald-500/15 bg-[#111916] p-3">
                <div className="mb-2 flex items-center justify-between text-xs">
                  <span className="font-semibold text-emerald-100">
                    Velocidad de ruta
                  </span>
                  <span className="font-mono text-emerald-400">
                    {speedKmh} km/h
                  </span>
                </div>
                <div className="grid grid-cols-4 gap-1.5">
                  {(Object.keys(SPEED_PRESETS) as SpeedPresetId[]).map(
                    (presetId) => (
                      <button
                        key={presetId}
                        type="button"
                        onClick={() => handleSelectSpeedPreset(presetId)}
                        className={cn(
                          "rounded-lg py-1.5 text-[11px] font-medium transition",
                          speedPreset === presetId
                            ? "bg-[#16a34a] text-white"
                            : "bg-[#0a0f0d] text-emerald-200/70 hover:text-white"
                        )}
                      >
                        {SPEED_PRESETS[presetId].label}
                      </button>
                    )
                  )}
                </div>
                <input
                  type="range"
                  min={2}
                  max={160}
                  step={1}
                  value={speedKmh}
                  onChange={(e) => {
                    setSpeedPreset("custom");
                    setSpeedKmh(Number(e.target.value));
                  }}
                  className="mt-2.5 w-full accent-[#16a34a]"
                />
              </div>

              {/* Route Playback Bar */}
              <div className="rounded-xl border border-emerald-500/15 bg-[#111916] p-3">
                <div className="mb-2 flex items-center justify-between text-xs text-emerald-200/75">
                  <span>Distancia: {formatDistance(routeDistanceMeters)}</span>
                  <span>ETA: {formatDuration(estimatedSeconds)}</span>
                </div>

                <div className="mb-3 h-1.5 w-full overflow-hidden rounded-full bg-[#0a0f0d]">
                  <div
                    className="h-full bg-[#16a34a] transition-all duration-150"
                    style={{ width: `${routeProgressPct}%` }}
                  />
                </div>

                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    disabled={waypoints.length < 2}
                    onClick={handleStartRoute}
                    className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-[#16a34a] py-2 text-xs font-semibold text-white transition hover:bg-emerald-500 disabled:opacity-40"
                  >
                    {isSimulatingRoute ? (
                      <>
                        <Pause className="h-3.5 w-3.5" />
                        <span>Pausar</span>
                      </>
                    ) : (
                      <>
                        <Play className="h-3.5 w-3.5" />
                        <span>Simular ruta</span>
                      </>
                    )}
                  </button>

                  <button
                    type="button"
                    disabled={waypoints.length === 0}
                    onClick={handleStopRoute}
                    className="rounded-xl border border-emerald-500/25 bg-[#0a0f0d] p-2 text-emerald-200 hover:bg-emerald-500/15 disabled:opacity-40"
                    title="Detener y reiniciar"
                  >
                    <Square className="h-3.5 w-3.5" />
                  </button>

                  <button
                    type="button"
                    onClick={() => setLoopRoute((v) => !v)}
                    className={cn(
                      "rounded-xl border p-2 transition",
                      loopRoute
                        ? "border-emerald-400 bg-emerald-500/20 text-emerald-300"
                        : "border-emerald-500/25 bg-[#0a0f0d] text-emerald-200/70 hover:text-white"
                    )}
                    title="Repetir ruta en bucle"
                  >
                    <Repeat className="h-3.5 w-3.5" />
                  </button>

                  <button
                    type="button"
                    disabled={waypoints.length === 0}
                    onClick={handleExportGpx}
                    className="rounded-xl border border-emerald-500/25 bg-[#0a0f0d] p-2 text-emerald-200 hover:bg-emerald-500/15 disabled:opacity-40"
                    title="Exportar GPX"
                  >
                    <Download className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>

              {/* Waypoint List */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-xs text-emerald-200/70">
                  <span>Puntos de ruta ({waypoints.length})</span>
                  {waypoints.length > 0 && (
                    <button
                      type="button"
                      onClick={() => {
                        setIsSimulatingRoute(false);
                        setWaypoints([]);
                        setRouteProgressPct(0);
                      }}
                      className="flex items-center gap-1 text-[11px] text-rose-300 hover:text-rose-200"
                    >
                      <RotateCcw className="h-3 w-3" />
                      Limpiar ruta
                    </button>
                  )}
                </div>

                {waypoints.length === 0 ? (
                  <p className="rounded-xl border border-dashed border-emerald-500/20 p-3 text-center text-xs text-emerald-200/50">
                    Activa "Añadir puntos en mapa" y pulsa dos o más ubicaciones
                    para trazar una ruta GPS.
                  </p>
                ) : (
                  <ul className="space-y-1.5">
                    {waypoints.map((wp, idx) => (
                      <li
                        key={wp.id}
                        className="flex items-center justify-between rounded-xl border border-emerald-500/15 bg-[#111916] px-3 py-2 text-xs"
                      >
                        <button
                          type="button"
                          onClick={() =>
                            jumpToLocation({ lat: wp.lat, lng: wp.lng })
                          }
                          className="flex items-center gap-2 text-left"
                        >
                          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500/20 text-[10px] font-bold text-emerald-300">
                            {idx + 1}
                          </span>
                          <span className="font-mono text-[11px] text-emerald-100">
                            {wp.lat.toFixed(5)}, {wp.lng.toFixed(5)}
                          </span>
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setIsSimulatingRoute(false);
                            setWaypoints((prev) =>
                              prev.filter((item) => item.id !== wp.id)
                            );
                          }}
                          className="rounded p-1 text-emerald-200/50 hover:bg-rose-500/15 hover:text-rose-300"
                          aria-label="Eliminar punto"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          )}

          {activeTab === "favorites" && (
            <div className="space-y-2.5">
              <div className="flex items-center justify-between text-xs text-emerald-200/70">
                <span>Ubicaciones guardadas ({favorites.length})</span>
                <button
                  type="button"
                  onClick={() => setShowSaveFavoriteForm(true)}
                  className="flex items-center gap-1 text-emerald-400 hover:text-emerald-300"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Guardar actual
                </button>
              </div>

              {favorites.length === 0 ? (
                <p className="rounded-xl border border-dashed border-emerald-500/20 p-4 text-center text-xs text-emerald-200/50">
                  No tienes ubicaciones favoritas aún.
                </p>
              ) : (
                <ul className="space-y-2">
                  {favorites.map((fav) => (
                    <li
                      key={fav.id}
                      className="flex items-center justify-between gap-2 rounded-xl border border-emerald-500/15 bg-[#111916] p-2.5 transition hover:border-emerald-400/40"
                    >
                      <button
                        type="button"
                        onClick={() =>
                          jumpToLocation({ lat: fav.lat, lng: fav.lng })
                        }
                        className="flex min-w-0 flex-1 items-start gap-2.5 text-left"
                      >
                        <Star className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
                        <div className="min-w-0">
                          <div className="truncate text-xs font-semibold text-emerald-50">
                            {fav.name}
                          </div>
                          <div className="truncate font-mono text-[11px] text-emerald-200/55">
                            {fav.subtitle ??
                              `${fav.lat.toFixed(4)}, ${fav.lng.toFixed(4)}`}
                          </div>
                        </div>
                      </button>

                      <button
                        type="button"
                        onClick={() =>
                          setFavorites((prev) =>
                            prev.filter((item) => item.id !== fav.id)
                          )
                        }
                        className="shrink-0 rounded-lg p-1.5 text-emerald-200/45 transition hover:bg-rose-500/15 hover:text-rose-300"
                        aria-label={`Eliminar ${fav.name}`}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}

export default App;
