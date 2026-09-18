"use client";

import type { Feature, FeatureCollection, Geometry } from "geojson";
import L from "leaflet";
import { useEffect, useRef, useState, type MutableRefObject } from "react";
import { CircleMarker, GeoJSON, MapContainer, TileLayer, Tooltip, useMap } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import "./eco-map.css";

export type MapViewState = {
  center: [number, number];
  zoom: number;
};

export const FULL_MAP_VIEW: MapViewState = {
  center: [45, -100],
  zoom: 3
};

export type MapOverlayMode = "ecoregion" | "metro";

export type RegionLabel = {
  level1: string;
  level2: string;
  level3: string;
};

type MapFeatureProps = {
  id: string;
  name: string;
  detail?: string;
};

type MapFeature = Feature<Geometry, MapFeatureProps>;

type MetroPoint = {
  id: string;
  name: string;
  detail?: string;
  lat: number;
  lon: number;
};

const LEVEL1_COLORS: Record<string, string> = {
  "1": "#7eb6d9",
  "2": "#5aa0cf",
  "3": "#6f9e76",
  "4": "#8fb56a",
  "5": "#4f8f5a",
  "6": "#c4a35a",
  "7": "#d4b56a",
  "8": "#b8894a",
  "9": "#c47a5a",
  "10": "#d9a066",
  "11": "#a67c52",
  "12": "#8d6e63",
  "13": "#7a8f9c",
  "14": "#9aa7b0",
  "15": "#5f9e8f"
};

function colorForEcoregion(code: string): string {
  const level1 = code.split(".")[0] ?? "";
  return LEVEL1_COLORS[level1] ?? "#8aa0a8";
}

function ecoPathStyle(code: string, selectedCode: string): L.PathOptions {
  const selected = code === selectedCode;
  return {
    fillColor: colorForEcoregion(code),
    color: selected ? "#0d6670" : "rgba(35, 55, 62, 0.55)",
    weight: selected ? 2.4 : 0.55,
    opacity: 1,
    fillOpacity: selected ? 0.82 : 0.38
  };
}

function metroPathStyle(selected: boolean): L.PathOptions {
  return {
    fillColor: selected ? "#0d6670" : "#5aa8b2",
    color: selected ? "#0a4f57" : "rgba(13, 102, 112, 0.65)",
    weight: selected ? 2.4 : 1,
    opacity: 1,
    fillOpacity: selected ? 0.45 : 0.18
  };
}

function copyView(view: MapViewState): MapViewState {
  return {
    center: [view.center[0], view.center[1]],
    zoom: view.zoom
  };
}

function FocusSelected({
  data,
  selectedCode,
  enabled,
  maxZoom
}: {
  data: FeatureCollection<Geometry, MapFeatureProps> | null;
  selectedCode: string;
  enabled: boolean;
  maxZoom: number;
}) {
  const map = useMap();
  const previousCodeRef = useRef<string | null>(selectedCode);

  useEffect(() => {
    if (!data || !selectedCode) return;

    if (!enabled) {
      previousCodeRef.current = selectedCode;
      return;
    }

    if (previousCodeRef.current === selectedCode) return;
    previousCodeRef.current = selectedCode;

    const matches = data.features.filter((feature) => feature.properties?.id === selectedCode);
    if (!matches.length) return;
    const collection: FeatureCollection<Geometry, MapFeatureProps> = {
      type: "FeatureCollection",
      features: matches
    };
    const layer = L.geoJSON(collection as never);
    const bounds = layer.getBounds();
    if (bounds.isValid()) {
      map.fitBounds(bounds, { padding: [18, 18], maxZoom, animate: true });
    }
  }, [data, selectedCode, enabled, map, maxZoom]);

  return null;
}

function MapResizeFix() {
  const map = useMap();
  useEffect(() => {
    const container = map.getContainer();
    const observer = new ResizeObserver(() => {
      map.invalidateSize({ animate: false });
    });
    observer.observe(container);
    map.invalidateSize({ animate: false });
    return () => observer.disconnect();
  }, [map]);
  return null;
}

/** Keeps a live Leaflet map reference for toolbar actions outside the MapContainer tree. */
function MapHandle({ mapRef }: { mapRef: MutableRefObject<L.Map | null> }) {
  const map = useMap();
  useEffect(() => {
    mapRef.current = map;
    return () => {
      if (mapRef.current === map) mapRef.current = null;
    };
  }, [map, mapRef]);
  return null;
}

function ViewPersistence({
  view,
  onViewChange,
  suppressSaveRef
}: {
  view: MapViewState;
  onViewChange: (view: MapViewState) => void;
  suppressSaveRef: MutableRefObject<boolean>;
}) {
  const map = useMap();
  const onViewChangeRef = useRef(onViewChange);

  useEffect(() => {
    onViewChangeRef.current = onViewChange;
  }, [onViewChange]);

  const centerLat = view.center[0];
  const centerLng = view.center[1];
  const zoom = view.zoom;

  useEffect(() => {
    const center = map.getCenter();
    const currentZoom = map.getZoom();
    const samePlace =
      Math.abs(center.lat - centerLat) < 1e-4 &&
      Math.abs(center.lng - centerLng) < 1e-4 &&
      currentZoom === zoom;
    if (samePlace) return;

    suppressSaveRef.current = true;
    map.setView([centerLat, centerLng], zoom, { animate: false });
    map.once("moveend", () => {
      suppressSaveRef.current = false;
    });
  }, [map, centerLat, centerLng, zoom, suppressSaveRef]);

  useEffect(() => {
    const save = () => {
      if (suppressSaveRef.current) return;
      const center = map.getCenter();
      onViewChangeRef.current({
        center: [center.lat, center.lng],
        zoom: map.getZoom()
      });
    };
    map.on("moveend", save);
    map.on("zoomend", save);
    return () => {
      map.off("moveend", save);
      map.off("zoomend", save);
    };
  }, [map, suppressSaveRef]);

  return null;
}

function normalizeEcoregionData(
  json: FeatureCollection<Geometry, { code?: string; name?: string }>
): FeatureCollection<Geometry, MapFeatureProps> {
  return {
    type: "FeatureCollection",
    features: json.features.map((feature) => ({
      ...feature,
      properties: {
        id: String(feature.properties?.code ?? ""),
        name: String(feature.properties?.name ?? feature.properties?.code ?? "")
      }
    }))
  };
}

function normalizeMetroBuffers(
  json: FeatureCollection<
    Geometry,
    { city?: string; metro_name?: string; country?: string }
  >
): FeatureCollection<Geometry, MapFeatureProps> {
  return {
    type: "FeatureCollection",
    features: json.features
      .map((feature) => {
        const city = String(feature.properties?.city ?? "").trim();
        return {
          ...feature,
          properties: {
            id: city,
            name: city,
            detail: String(feature.properties?.country ?? "").trim() || undefined
          }
        };
      })
      .filter((feature) => feature.properties.id)
  };
}

function normalizeMetroPoints(
  json: FeatureCollection<
    Geometry,
    { city?: string; country?: string; lat?: number; lon?: number }
  >
): MetroPoint[] {
  return json.features
    .map((feature) => {
      const city = String(feature.properties?.city ?? "").trim();
      const lat = Number(feature.properties?.lat);
      const lon = Number(feature.properties?.lon);
      return {
        id: city,
        name: city,
        detail: String(feature.properties?.country ?? "").trim() || undefined,
        lat,
        lon
      };
    })
    .filter((point) => point.id && Number.isFinite(point.lat) && Number.isFinite(point.lon));
}

export default function EcoRegionMap({
  selectedCode,
  onSelect,
  overlayMode = "ecoregion",
  showOverlay,
  onShowOverlayChange,
  view,
  onViewChange,
  onExitToInitialView,
  regionLabels = {},
  compact = false
}: {
  selectedCode: string;
  onSelect: (code: string) => void;
  overlayMode?: MapOverlayMode;
  showOverlay: boolean;
  onShowOverlayChange: (show: boolean) => void;
  view: MapViewState;
  onViewChange: (view: MapViewState) => void;
  /** Leave the chart workspace and restore the initial full-screen map layout. */
  onExitToInitialView?: () => void;
  regionLabels?: Record<string, RegionLabel>;
  compact?: boolean;
}) {
  const [data, setData] = useState<FeatureCollection<Geometry, MapFeatureProps> | null>(null);
  const [metroPoints, setMetroPoints] = useState<MetroPoint[]>([]);
  const [loadError, setLoadError] = useState("");
  const geoJsonRef = useRef<L.GeoJSON | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const suppressSaveRef = useRef(false);
  const selectedRef = useRef(selectedCode);
  const labelsRef = useRef(regionLabels);
  const isMetro = overlayMode === "metro";

  useEffect(() => {
    selectedRef.current = selectedCode;
  }, [selectedCode]);

  useEffect(() => {
    labelsRef.current = regionLabels;
  }, [regionLabels]);

  function escapeHtml(value: string): string {
    return value
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
  }

  function tooltipFor(id: string, fallbackName: string, detail?: string): string {
    if (isMetro) {
      const parts = [fallbackName || id, detail].filter(Boolean) as string[];
      return `<span class="eco-map-tooltip-body">${parts.map(escapeHtml).join("<br/>")}</span>`;
    }
    const label = labelsRef.current[id];
    const parts = label
      ? [id, label.level1, label.level2, label.level3]
      : [id, fallbackName];
    return `<span class="eco-map-tooltip-body">${parts.map(escapeHtml).join("<br/>")}</span>`;
  }

  function styleFor(id: string, selectedId: string): L.PathOptions {
    return isMetro ? metroPathStyle(id === selectedId) : ecoPathStyle(id, selectedId);
  }

  function resetToFullMap() {
    const next = copyView(FULL_MAP_VIEW);
    const map = mapRef.current;
    if (map) {
      suppressSaveRef.current = true;
      map.stop();
      map.setView(next.center, next.zoom, { animate: true });
      map.once("moveend", () => {
        suppressSaveRef.current = false;
        onViewChange(copyView(next));
      });
    }
    onViewChange(next);
    onExitToInitialView?.();
  }

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoadError("");
      setData(null);
      setMetroPoints([]);
      try {
        if (overlayMode === "metro") {
          const [buffersResponse, pointsResponse] = await Promise.all([
            fetch("/data/major_cities_buffers.geojson"),
            fetch("/data/major_cities_points.geojson")
          ]);
          if (!buffersResponse.ok) throw new Error(`HTTP ${buffersResponse.status}`);
          if (!pointsResponse.ok) throw new Error(`HTTP ${pointsResponse.status}`);
          const buffersJson = (await buffersResponse.json()) as FeatureCollection<
            Geometry,
            { city?: string; metro_name?: string; country?: string }
          >;
          const pointsJson = (await pointsResponse.json()) as FeatureCollection<
            Geometry,
            { city?: string; country?: string; lat?: number; lon?: number }
          >;
          if (!cancelled) {
            setData(normalizeMetroBuffers(buffersJson));
            setMetroPoints(normalizeMetroPoints(pointsJson));
          }
          return;
        }

        const response = await fetch("/data/na_level3_ecoregions.geojson");
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const json = (await response.json()) as FeatureCollection<
          Geometry,
          { code?: string; name?: string }
        >;
        if (!cancelled) setData(normalizeEcoregionData(json));
      } catch (error) {
        if (!cancelled) {
          setLoadError(error instanceof Error ? error.message : String(error));
        }
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [overlayMode]);

  useEffect(() => {
    if (!showOverlay) return;
    const layer = geoJsonRef.current;
    if (!layer) return;
    layer.eachLayer((path) => {
      const feature = (path as L.Layer & { feature?: MapFeature }).feature;
      const id = feature?.properties?.id;
      if (!id) return;
      const nextStyle = isMetro ? metroPathStyle(id === selectedCode) : ecoPathStyle(id, selectedCode);
      (path as L.Path).setStyle(nextStyle);
      if (id === selectedCode) (path as L.Path).bringToFront();
    });
  }, [selectedCode, data, showOverlay, isMetro]);

  if (loadError) {
    return <div className="map-fallback">Could not load map: {loadError}</div>;
  }

  return (
    <div className={`eco-map${compact ? " eco-map-compact" : ""}`}>
      <MapContainer
        center={view.center}
        zoom={view.zoom}
        minZoom={2}
        maxZoom={10}
        scrollWheelZoom
        attributionControl={false}
        className="eco-map-canvas"
      >
        <MapResizeFix />
        <MapHandle mapRef={mapRef} />
        <ViewPersistence
          view={view}
          onViewChange={onViewChange}
          suppressSaveRef={suppressSaveRef}
        />
        <TileLayer
          url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          maxZoom={19}
        />
        {showOverlay && data ? (
          <GeoJSON
            key={`${overlayMode}-on-${Object.keys(regionLabels).length}`}
            ref={geoJsonRef}
            data={data}
            style={(feature) => styleFor(feature?.properties?.id ?? "", selectedRef.current)}
            onEachFeature={(feature, layer) => {
              const props = (feature as MapFeature).properties;
              layer.bindTooltip(tooltipFor(props.id, props.name, props.detail), {
                sticky: true,
                opacity: 0.95,
                className: "eco-map-tooltip",
                direction: "top"
              });
              layer.on({
                click: () => onSelect(props.id),
                mouseover: (event) => {
                  const target = event.target as L.Path;
                  target.setStyle({
                    weight: 2,
                    fillOpacity: isMetro ? 0.35 : 0.7,
                    color: "#0d6670"
                  });
                  target.bringToFront();
                },
                mouseout: (event) => {
                  const target = event.target as L.Path;
                  target.setStyle(styleFor(props.id, selectedRef.current));
                  if (props.id === selectedRef.current) target.bringToFront();
                }
              });
            }}
          />
        ) : null}
        {showOverlay && isMetro
          ? metroPoints.map((point) => {
              const selected = point.id === selectedCode;
              return (
                <CircleMarker
                  key={point.id}
                  center={[point.lat, point.lon]}
                  radius={selected ? 7 : 5}
                  pathOptions={{
                    color: selected ? "#0a4f57" : "#0d6670",
                    weight: 1.5,
                    fillColor: selected ? "#0d6670" : "#ffffff",
                    fillOpacity: 1
                  }}
                  eventHandlers={{
                    click: () => onSelect(point.id)
                  }}
                >
                  <Tooltip direction="top" opacity={0.95} className="eco-map-tooltip">
                    <span className="eco-map-tooltip-body">
                      {point.name}
                      {point.detail ? (
                        <>
                          <br />
                          {point.detail}
                        </>
                      ) : null}
                    </span>
                  </Tooltip>
                </CircleMarker>
              );
            })
          : null}
        <FocusSelected
          data={data}
          selectedCode={selectedCode}
          enabled={showOverlay}
          maxZoom={isMetro ? 8 : 6}
        />
      </MapContainer>

      <div className="map-toolbar">
        {compact ? (
          <button
            type="button"
            className="map-tool-btn"
            onClick={resetToFullMap}
            title="Back to the initial full-screen map"
            aria-label="Back to the initial full-screen map"
          >
            Full map
          </button>
        ) : null}
        <button
          type="button"
          className={`map-tool-btn map-toggle${showOverlay ? " active" : ""}`}
          onClick={() => onShowOverlayChange(!showOverlay)}
          aria-pressed={showOverlay}
        >
          {isMetro
            ? showOverlay
              ? "Cities on"
              : "Cities off"
            : showOverlay
              ? "Ecoregions on"
              : "Ecoregions off"}
        </button>
      </div>
    </div>
  );
}
