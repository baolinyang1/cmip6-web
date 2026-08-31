"use client";

import type { Feature, FeatureCollection, Geometry } from "geojson";
import L from "leaflet";
import { useEffect, useRef, useState, type MutableRefObject } from "react";
import { GeoJSON, MapContainer, TileLayer, useMap } from "react-leaflet";
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

export type RegionLabel = {
  level1: string;
  level2: string;
  level3: string;
};

type EcoFeatureProps = {
  code: string;
  name: string;
};

type EcoFeature = Feature<Geometry, EcoFeatureProps>;

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

function colorForCode(code: string): string {
  const level1 = code.split(".")[0] ?? "";
  return LEVEL1_COLORS[level1] ?? "#8aa0a8";
}

function pathStyle(code: string, selectedCode: string): L.PathOptions {
  const selected = code === selectedCode;
  return {
    fillColor: colorForCode(code),
    color: selected ? "#0d6670" : "rgba(35, 55, 62, 0.55)",
    weight: selected ? 2.4 : 0.55,
    opacity: 1,
    fillOpacity: selected ? 0.82 : 0.38
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
  enabled
}: {
  data: FeatureCollection<Geometry, EcoFeatureProps> | null;
  selectedCode: string;
  enabled: boolean;
}) {
  const map = useMap();
  // Seed with the current selection so remounts / overlay toggles do not auto-zoom.
  const previousCodeRef = useRef<string | null>(selectedCode);

  useEffect(() => {
    if (!data || !selectedCode) return;

    // Keep the current view when ecoregions are toggled on/off.
    // Only zoom when the selected region changes while the overlay is visible.
    if (!enabled) {
      previousCodeRef.current = selectedCode;
      return;
    }

    if (previousCodeRef.current === selectedCode) return;
    previousCodeRef.current = selectedCode;

    const matches = data.features.filter((feature) => feature.properties?.code === selectedCode);
    if (!matches.length) return;
    const collection: FeatureCollection<Geometry, EcoFeatureProps> = {
      type: "FeatureCollection",
      features: matches
    };
    const layer = L.geoJSON(collection as never);
    const bounds = layer.getBounds();
    if (bounds.isValid()) {
      map.fitBounds(bounds, { padding: [18, 18], maxZoom: 6, animate: true });
    }
  }, [data, selectedCode, enabled, map]);

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

export default function EcoRegionMap({
  selectedCode,
  onSelect,
  showEcoregions,
  onShowEcoregionsChange,
  view,
  onViewChange,
  onExitToInitialView,
  regionLabels = {},
  compact = false
}: {
  selectedCode: string;
  onSelect: (code: string) => void;
  showEcoregions: boolean;
  onShowEcoregionsChange: (show: boolean) => void;
  view: MapViewState;
  onViewChange: (view: MapViewState) => void;
  /** Leave the chart workspace and restore the initial full-screen map layout. */
  onExitToInitialView?: () => void;
  regionLabels?: Record<string, RegionLabel>;
  compact?: boolean;
}) {
  const [data, setData] = useState<FeatureCollection<Geometry, EcoFeatureProps> | null>(null);
  const [loadError, setLoadError] = useState("");
  const geoJsonRef = useRef<L.GeoJSON | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const suppressSaveRef = useRef(false);
  const selectedRef = useRef(selectedCode);
  const labelsRef = useRef(regionLabels);

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

  function tooltipFor(code: string, fallbackName: string): string {
    const label = labelsRef.current[code];
    const parts = label
      ? [code, label.level1, label.level2, label.level3]
      : [code, fallbackName];
    return `<span class="eco-map-tooltip-body">${parts.map(escapeHtml).join("<br/>")}</span>`;
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
    // Restore the app's initial full-screen map layout (exit chart workspace).
    onExitToInitialView?.();
  }

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const response = await fetch("/data/na_level3_ecoregions.geojson");
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const json = (await response.json()) as FeatureCollection<Geometry, EcoFeatureProps>;
        if (!cancelled) setData(json);
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
  }, []);

  useEffect(() => {
    if (!showEcoregions) return;
    const layer = geoJsonRef.current;
    if (!layer) return;
    layer.eachLayer((path) => {
      const feature = (path as L.Layer & { feature?: EcoFeature }).feature;
      const code = feature?.properties?.code;
      if (!code) return;
      (path as L.Path).setStyle(pathStyle(code, selectedCode));
      if (code === selectedCode) (path as L.Path).bringToFront();
    });
  }, [selectedCode, data, showEcoregions]);

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
        {/* OpenStreetMap basemap — no API key required. */}
        <TileLayer
          url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          maxZoom={19}
        />
        {showEcoregions && data ? (
          <GeoJSON
            key={`ecoregions-on-${Object.keys(regionLabels).length}`}
            ref={geoJsonRef}
            data={data}
            style={(feature) => pathStyle(feature?.properties?.code ?? "", selectedRef.current)}
            onEachFeature={(feature, layer) => {
              const props = (feature as EcoFeature).properties;
              layer.bindTooltip(tooltipFor(props.code, props.name), {
                sticky: true,
                opacity: 0.95,
                className: "eco-map-tooltip",
                direction: "top"
              });
              layer.on({
                click: () => onSelect(props.code),
                mouseover: (event) => {
                  const target = event.target as L.Path;
                  target.setStyle({
                    weight: 2,
                    fillOpacity: 0.7,
                    color: "#0d6670"
                  });
                  target.bringToFront();
                },
                mouseout: (event) => {
                  const target = event.target as L.Path;
                  target.setStyle(pathStyle(props.code, selectedRef.current));
                  if (props.code === selectedRef.current) target.bringToFront();
                }
              });
            }}
          />
        ) : null}
        <FocusSelected data={data} selectedCode={selectedCode} enabled={showEcoregions} />
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
          className={`map-tool-btn map-toggle${showEcoregions ? " active" : ""}`}
          onClick={() => onShowEcoregionsChange(!showEcoregions)}
          aria-pressed={showEcoregions}
        >
          {showEcoregions ? "Ecoregions on" : "Ecoregions off"}
        </button>
      </div>
    </div>
  );
}
