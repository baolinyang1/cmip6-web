"use client";

import dynamic from "next/dynamic";
import Papa from "papaparse";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { flushSync } from "react-dom";
import ChartWindow, {
  COLLAPSED_HEIGHT,
  MIN_WINDOW_HEIGHT,
  MIN_WINDOW_WIDTH,
  type ChartWindowModel
} from "./ChartWindow";
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

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

function layoutSlot(
  slot: number,
  stageW: number,
  stageH: number,
  width: number,
  height: number
): { x: number; y: number } {
  const cols = Math.max(1, Math.floor((stageW - GRID_GAP) / (width + GRID_GAP)));
  const usableH = Math.max(height, stageH - HEADER_SPACE - GRID_GAP);
  const rows = Math.max(1, Math.floor(usableH / (height + GRID_GAP)));
  const capacity = cols * rows;
  const index = slot % Math.max(1, capacity);
  const col = index % cols;
  const row = Math.floor(index / cols);
  const totalRowWidth = cols * width + (cols - 1) * GRID_GAP;
  const offsetX = Math.max(GRID_GAP, Math.round((stageW - totalRowWidth) / 2));
  const x = offsetX + col * (width + GRID_GAP);
  const y = HEADER_SPACE + row * (height + GRID_GAP);
  return {
    x: clamp(x, GRID_GAP, Math.max(GRID_GAP, stageW - width - GRID_GAP)),
    y: clamp(y, GRID_GAP, Math.max(GRID_GAP, stageH - height - GRID_GAP))
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
          return { code: values[0], level1: values[1], level2: values[2], level3: values[3] };
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
      const { x, y } = layoutSlot(slot, stageW, stageH, width, height);

      zCounterRef.current += 1;

      setCharts((previous) => [
        ...previous,
        {
          id: `${idBase}-${index}`,
          title: `${season[0].toUpperCase() + season.slice(1)} ${variableTitle(variable)} change`,
          subtitle: `${selectedEco}${region ? ` · ${region.level3}` : ""}`,
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
    setCharts((previous) => previous.map((chart) =>
      chart.id === id ? { ...chart, collapsed: !chart.collapsed } : chart
    ));
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
                  <option key={region.code} value={region.code}>{region.code} — {region.level3}</option>
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
                {generating ? "Generating…" : workspaceActive ? "Generate another chart" : "Generate chart"}
              </button>
              {hasCharts ? (
                <button type="button" className="secondary-btn" onClick={() => setCharts([])}>
                  Remove all charts ({charts.length})
                </button>
              ) : null}
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
                />
              </div>
            </section>
          ) : (
            <section className="panel chart-workspace" ref={workspaceRef}>
              <div className="chart-workspace-center">
                <h2>Chart workspace</h2>
                <p>Collapse, expand, or remove charts. Generate more from the sidebar to compare.</p>
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
