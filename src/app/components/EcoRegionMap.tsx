"use client";

import type { Feature, FeatureCollection, Geometry } from "geojson";
import L from "leaflet";
import { useEffect, useRef, useState } from "react";
import { GeoJSON, MapContainer, TileLayer, useMap } from "react-leaflet";
import "leaflet/dist/leaflet.css";

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
    fillOpacity: selected ? 0.88 : 0.42
  };
}

function FocusSelected({
  data,
  selectedCode
}: {
  data: FeatureCollection<Geometry, EcoFeatureProps> | null;
  selectedCode: string;
}) {
  const map = useMap();

  useEffect(() => {
    if (!data || !selectedCode) return;
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
  }, [data, selectedCode, map]);

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

export default function EcoRegionMap({
  selectedCode,
  onSelect
}: {
  selectedCode: string;
  onSelect: (code: string) => void;
}) {
  const [data, setData] = useState<FeatureCollection<Geometry, EcoFeatureProps> | null>(null);
  const [loadError, setLoadError] = useState("");
  const geoJsonRef = useRef<L.GeoJSON | null>(null);
  const selectedRef = useRef(selectedCode);
  selectedRef.current = selectedCode;

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
    const layer = geoJsonRef.current;
    if (!layer) return;
    layer.eachLayer((path) => {
      const feature = (path as L.Layer & { feature?: EcoFeature }).feature;
      const code = feature?.properties?.code;
      if (!code) return;
      (path as L.Path).setStyle(pathStyle(code, selectedCode));
      if (code === selectedCode) (path as L.Path).bringToFront();
    });
  }, [selectedCode, data]);

  if (loadError) {
    return <div className="map-fallback">Could not load interactive map: {loadError}</div>;
  }

  if (!data) {
    return <div className="map-fallback">Loading interactive ecoregion map…</div>;
  }

  return (
    <div className="eco-map">
      <MapContainer
        center={[48, -100]}
        zoom={2}
        minZoom={1}
        maxZoom={8}
        scrollWheelZoom
        attributionControl={false}
        className="eco-map-canvas"
      >
        <MapResizeFix />
        <TileLayer
          url="https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png"
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/">CARTO</a>'
        />
        <GeoJSON
          ref={geoJsonRef}
          data={data}
          style={(feature) => pathStyle(feature?.properties?.code ?? "", selectedRef.current)}
          onEachFeature={(feature, layer) => {
            const props = (feature as EcoFeature).properties;
            layer.bindTooltip(`${props.code} · ${props.name}`, { sticky: true, opacity: 0.95 });
            layer.on({
              click: () => onSelect(props.code),
              mouseover: (event) => {
                const target = event.target as L.Path;
                target.setStyle({
                  weight: 2,
                  fillOpacity: 0.72,
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
        <FocusSelected data={data} selectedCode={selectedCode} />
      </MapContainer>
    </div>
  );
}
