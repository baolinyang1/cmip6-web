"use client";

import dynamic from "next/dynamic";
import Papa from "papaparse";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import ChartWindow, {
  COLLAPSED_HEIGHT,
  MIN_WINDOW_HEIGHT,
  MIN_WINDOW_WIDTH,
  type ChartWindowModel
} from "./ChartWindow";
import type { RegionLabel } from "./EcoRegionMap";
import {
  buildTraces,
  normalize,
  schemaErrorFor,
  SCENARIOS,
  type CsvRow,
  type Season,
  type Variable,
  variableTitle
} from "./chartTraces";

const EcoRegionMap = dynamic(() => import("./EcoRegionMap"), {
  ssr: false,
  loading: () => <div className="map-fallback">Loading map…</div>
});

type EcoRegion = {
  code: string;
  level1: string;
  level2: string;
  level3: string;
};

const SEASONS: Season[] = ["annual", "winter", "spring", "summer", "fall"];
const DEFAULT_WIDTH = 750;
const DEFAULT_HEIGHT = 500;
const GRID_GAP = 14;
const HEADER_SPACE = 72;
const CASCADE_Y = 48;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

/** EPA Level II names ship in ALL CAPS; normalize for display. */
function titleCaseName(value: string): string {
  return value
    .toLowerCase()
    .replace(/\b([a-z])/g, (char) => char.toUpperCase());
}

function layoutSlot(
  slot: number,
  stageW: number,
  stageH: number,
  width: number
): { x: number; y: number } {
  const x = Math.max(GRID_GAP, Math.round((stageW - width) / 2));
  // Step each new chart down so title bars stay visible; size is unchanged.
  const maxY = Math.max(HEADER_SPACE, stageH - COLLAPSED_HEIGHT - GRID_GAP);
  const steps = Math.max(1, Math.floor((maxY - HEADER_SPACE) / CASCADE_Y) + 1);
  const y = HEADER_SPACE + (slot % steps) * CASCADE_Y;
  return {
    x: clamp(x, GRID_GAP, Math.max(GRID_GAP, stageW - width - GRID_GAP)),
    y: clamp(y, HEADER_SPACE, maxY)
  };
}

async function loadCsv(urls: string[]): Promise<{ rows: CsvRow[]; url: string }> {
  const failures: string[] = [];
  for (const url of urls) {
    try {
      const response = await fetch(url);
      if (!response.ok) {
        failures.push(`${url}: HTTP ${response.status}`);
        continue;
      }
      const text = await response.text();
      const parsed = Papa.parse<CsvRow>(text, {
        header: true,
        dynamicTyping: true,
        skipEmptyLines: true,
        transformHeader: (h) => h.trim()
      });
      if (parsed.errors.length && parsed.data.length === 0) {
        failures.push(`${url}: ${parsed.errors[0].message}`);
        continue;
      }
      return { rows: parsed.data, url };
    } catch (error) {
      failures.push(`${url}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  throw new Error(`Could not load a CSV. Tried:\n${failures.join("\n")}`);
}

export default function ClimateDashboard() {
  const [variable, setVariable] = useState<Variable>("tas");
  const [season, setSeason] = useState<Season>("annual");
  const [selectedEco, setSelectedEco] = useState("");
  const [enabledScenarios, setEnabledScenarios] = useState<string[]>([...SCENARIOS]);
  const [ecoregions, setEcoregions] = useState<EcoRegion[]>([]);
  const [data, setData] = useState<Record<Variable, CsvRow[]>>({ tas: [], pr: [] });
  const [ecoLoading, setEcoLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState("");
  const [showEcoregions, setShowEcoregions] = useState(false);
  const [mapView, setMapView] = useState({ center: [45, -100] as [number, number], zoom: 3 });
  const [charts, setCharts] = useState<ChartWindowModel[]>([]);
  const [workspaceActive, setWorkspaceActive] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const idBase = useId();
  const chartCountRef = useRef(0);
  const zCounterRef = useRef(100);
  const workspaceRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    async function loadEcoregions() {
      setEcoLoading(true);
      setError("");
      try {
        const ecoResult = await loadCsv(["/data/EcoRegionCode.csv"]);
        const ecoRows = ecoResult.rows.map((row) => {
          const values = Object.values(row).map(normalize);
          return {
            code: values[0],
            level1: values[1],
            level2: titleCaseName(values[2]),
            level3: values[3]
          };
        }).filter((row) => row.code);

        setEcoregions(ecoRows);
        setSelectedEco(ecoRows[0]?.code ?? "");
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setEcoLoading(false);
      }
    }
    loadEcoregions();
  }, []);

  const hasCharts = charts.length > 0;

  const regionLabels = useMemo(() => {
    const map: Record<string, RegionLabel> = {};
    for (const region of ecoregions) {
      map[region.code] = {
        level1: region.level1,
        level2: region.level2,
        level3: region.level3
      };
    }
    return map;
  }, [ecoregions]);

  const handleGenerate = useCallback(async () => {
    setGenerating(true);
    setError("");
    try {
      let nextData = data;
      if (!data.tas.length || !data.pr.length) {
        const [tasResult, prResult] = await Promise.all([
          loadCsv(["/data/Ave25yearSpan_tas.csv", "/data/EcoregionAve25yearSpan_tas.csv"]),
          loadCsv(["/data/Ave25yearSpan_pr.csv", "/data/EcoregionAve25yearSpan_pr.csv"])
        ]);
        nextData = { tas: tasResult.rows, pr: prResult.rows };
        setData(nextData);
      }

      const rows = nextData[variable];
      const schemaError = schemaErrorFor(rows, variable, season);
      if (schemaError) {
        setError(schemaError);
        return;
      }

      const traces = buildTraces(rows, {
        variable,
        season,
        selectedEco,
        enabledScenarios: [...enabledScenarios]
      });
      const region = ecoregions.find((item) => item.code === selectedEco);
      const index = chartCountRef.current;
      chartCountRef.current += 1;

      flushSync(() => setWorkspaceActive(true));

      const stage = workspaceRef.current;
      const stageW = stage?.clientWidth ?? 900;
      const stageH = stage?.clientHeight ?? 640;
      const width = Math.min(DEFAULT_WIDTH, Math.max(MIN_WINDOW_WIDTH, stageW - GRID_GAP * 2));
      const height = Math.min(DEFAULT_HEIGHT, Math.max(MIN_WINDOW_HEIGHT, stageH - HEADER_SPACE - GRID_GAP));
      const slot = charts.length;
      const { x, y } = layoutSlot(slot, stageW, stageH, width);

      zCounterRef.current += 1;

      setCharts((previous) => [
        ...previous,
        {
          id: `${idBase}-${index}`,
          title: `${season[0].toUpperCase() + season.slice(1)} ${variableTitle(variable)} change`,
          subtitle: region
            ? `${selectedEco} · ${region.level1} · ${region.level2} · ${region.level3}`
            : selectedEco,
          variable,
          traces,
          x,
          y,
          width,
          height,
          zIndex: zCounterRef.current,
          collapsed: false
        }
      ]);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setGenerating(false);
    }
  }, [data, variable, season, selectedEco, enabledScenarios, ecoregions, idBase, charts.length]);

  const closeChart = useCallback((id: string) => {
    setCharts((previous) => previous.filter((chart) => chart.id !== id));
  }, []);

  const toggleCollapse = useCallback((id: string) => {
    const stage = workspaceRef.current;
    const stageW = stage?.clientWidth ?? 0;
    const stageH = stage?.clientHeight ?? 0;
    setCharts((previous) => previous.map((chart) => {
      if (chart.id !== id) return chart;
      if (chart.collapsed) {
        const width = chart.savedWidth ?? chart.width;
        const height = chart.savedHeight ?? chart.height;
        return {
          ...chart,
          collapsed: false,
          width,
          height,
          x: clamp(chart.x, 0, Math.max(0, stageW - width)),
          y: clamp(chart.y, 0, Math.max(0, stageH - height)),
          savedWidth: undefined,
          savedHeight: undefined
        };
      }
      // Remember current size (including any enlarge/resize) for restore on expand.
      return {
        ...chart,
        collapsed: true,
        savedWidth: chart.width,
        savedHeight: chart.height
      };
    }));
  }, []);

  const collapseAllCharts = useCallback(() => {
    const stage = workspaceRef.current;
    const stageW = stage?.clientWidth ?? 900;
    const gap = GRID_GAP;
    const cols = 2;
    const top = 52;
    const layoutWidth = Math.max(280, Math.floor((stageW - gap * (cols + 1)) / cols));

    setCharts((previous) => previous.map((chart, index) => {
      const col = index % cols;
      const row = Math.floor(index / cols);
      const savedWidth = chart.collapsed
        ? (chart.savedWidth ?? chart.width)
        : chart.width;
      const savedHeight = chart.collapsed
        ? (chart.savedHeight ?? chart.height)
        : chart.height;
      return {
        ...chart,
        collapsed: true,
        savedWidth,
        savedHeight,
        width: layoutWidth,
        x: gap + col * (layoutWidth + gap),
        y: top + row * (COLLAPSED_HEIGHT + gap),
        zIndex: 100 + index
      };
    }));
  }, []);

  const focusChart = useCallback((id: string) => {
    setCharts((previous) => {
      const target = previous.find((chart) => chart.id === id);
      if (!target || target.zIndex === zCounterRef.current) return previous;
      zCounterRef.current += 1;
      const zIndex = zCounterRef.current;
      return previous.map((chart) => (chart.id === id ? { ...chart, zIndex } : chart));
    });
  }, []);

  const moveChart = useCallback((id: string, x: number, y: number) => {
    const stage = workspaceRef.current;
    const stageW = stage?.clientWidth ?? 0;
    const stageH = stage?.clientHeight ?? 0;
    setCharts((previous) => previous.map((chart) => {
      if (chart.id !== id) return chart;
      const h = chart.collapsed ? COLLAPSED_HEIGHT : chart.height;
      return {
        ...chart,
        x: clamp(x, 0, Math.max(0, stageW - chart.width)),
        y: clamp(y, 0, Math.max(0, stageH - h))
      };
    }));
  }, []);

  const resizeChart = useCallback((id: string, width: number, height: number) => {
    const stage = workspaceRef.current;
    const stageW = stage?.clientWidth ?? 0;
    const stageH = stage?.clientHeight ?? 0;
    setCharts((previous) => previous.map((chart) => {
      if (chart.id !== id || chart.collapsed) return chart;
      return {
        ...chart,
        width: clamp(width, MIN_WINDOW_WIDTH, Math.max(MIN_WINDOW_WIDTH, stageW - chart.x)),
        height: clamp(height, MIN_WINDOW_HEIGHT, Math.max(MIN_WINDOW_HEIGHT, stageH - chart.y))
      };
    }));
  }, []);

  const toggleScenario = (scenario: string) => {
    setEnabledScenarios((previous) => previous.includes(scenario)
      ? previous.filter((item) => item !== scenario)
      : [...previous, scenario]);
  };

  const canGenerate = !ecoLoading && !!selectedEco && !generating;

  return (
    <main className="shell">
      <header className="hero">
        <div>
          <h1>Climate projection explorer</h1>
          <p className="subtitle">
            {workspaceActive
              ? "Collapse, expand, or remove charts. The map stays in the sidebar — generate more to compare."
              : "Pick an ecoregion on the map, set your options, then generate a chart."}
          </p>
        </div>
        <div className="hero-note">Small dots are individual climate models. Large X markers are multi-model means. Violin widths show where model projections are concentrated.</div>
      </header>

      <section className={`dashboard${!sidebarOpen && workspaceActive ? " dashboard-map-only" : ""}`}>
        {sidebarOpen || !workspaceActive ? (
          <aside className="panel controls">
            <div className="controls-head">
              <h2>Controls</h2>
              {workspaceActive ? (
                <button
                  type="button"
                  className="icon-btn"
                  aria-label="Hide controls"
                  onClick={() => setSidebarOpen(false)}
                >
                  ×
                </button>
              ) : null}
            </div>

            <div className="control-group">
              <label>Climate variable</label>
              <div className="segmented">
                <button className={variable === "tas" ? "active" : ""} onClick={() => setVariable("tas")}>Temperature</button>
                <button className={variable === "pr" ? "active" : ""} onClick={() => setVariable("pr")}>Precipitation</button>
              </div>
            </div>

            <div className="control-group">
              <label htmlFor="season">Season</label>
              <select id="season" value={season} onChange={(event) => setSeason(event.target.value as Season)}>
                {SEASONS.map((item) => <option key={item} value={item}>{item[0].toUpperCase() + item.slice(1)}</option>)}
              </select>
            </div>

            <div className="control-group">
              <label htmlFor="ecoregion">Level III ecoregion</label>
              <select
                id="ecoregion"
                value={selectedEco}
                onChange={(event) => setSelectedEco(event.target.value)}
                disabled={ecoLoading}
              >
                {ecoregions.map((region) => (
                  <option
                    key={region.code}
                    value={region.code}
                    title={`${region.code} · ${region.level1} · ${region.level2} · ${region.level3}`}
                  >
                    {region.code} — {region.level3}
                  </option>
                ))}
              </select>
            </div>

            <div className="control-group">
              <label>SSP scenarios</label>
              <div className="checks">
                {SCENARIOS.map((scenario) => (
                  <label className="check" key={scenario}>
                    <input type="checkbox" checked={enabledScenarios.includes(scenario)} onChange={() => toggleScenario(scenario)} />
                    {scenario.toUpperCase()}
                  </label>
                ))}
              </div>
            </div>

            <div className="control-group generate-group">
              <button type="button" className="generate-btn" onClick={handleGenerate} disabled={!canGenerate}>
                {generating ? "Generating…" : workspaceActive ? "Generate chart" : "Generate chart"}
              </button>
            </div>

            {error ? <div className="error control-error">{error}</div> : null}

            {workspaceActive ? (
              <div className="map-card">
                <EcoRegionMap
                  selectedCode={selectedEco}
                  onSelect={setSelectedEco}
                  showEcoregions={showEcoregions}
                  onShowEcoregionsChange={setShowEcoregions}
                  view={mapView}
                  onViewChange={setMapView}
                  regionLabels={regionLabels}
                  compact
                />
                <div className="map-caption">Toggle ecoregions, then click a region to select it</div>
              </div>
            ) : null}
          </aside>
        ) : null}

        {workspaceActive && !sidebarOpen ? (
          <button type="button" className="sidebar-reopen" onClick={() => setSidebarOpen(true)}>
            Controls
          </button>
        ) : null}

        <div className="content">
          {!workspaceActive ? (
            <section className="panel map-stage">
              <div className="chart-head">
                <div>
                  <h2>North America</h2>
                  <p>Street map with major cities. Turn on ecoregions to select a region by clicking.</p>
                </div>
              </div>
              <div className="map-stage-body">
                <EcoRegionMap
                  selectedCode={selectedEco}
                  onSelect={setSelectedEco}
                  showEcoregions={showEcoregions}
                  onShowEcoregionsChange={setShowEcoregions}
                  view={mapView}
                  onViewChange={setMapView}
                  regionLabels={regionLabels}
                />
              </div>
            </section>
          ) : (
            <section className="panel chart-workspace" ref={workspaceRef}>
              <div className="chart-workspace-toolbar">
                {hasCharts ? (
                  <button type="button" className="workspace-tool-btn" onClick={collapseAllCharts}>
                    Collapse all charts
                  </button>
                ) : <span />}
                <p>Chart workspace: Collapse, expand, or remove charts. Generate more from the sidebar to compare.</p>
                {hasCharts ? (
                  <button type="button" className="workspace-tool-btn workspace-tool-btn-danger" onClick={() => setCharts([])}>
                    Remove all charts ({charts.length})
                  </button>
                ) : <span />}
              </div>
              <div className="chart-workspace-stage">
                {charts.map((chart) => (
                  <ChartWindow
                    key={chart.id}
                    chart={chart}
                    onClose={closeChart}
                    onFocus={focusChart}
                    onMove={moveChart}
                    onResize={resizeChart}
                    onToggleCollapse={toggleCollapse}
                  />
                ))}
              </div>
            </section>
          )}
        </div>
      </section>
    </main>
  );
}
