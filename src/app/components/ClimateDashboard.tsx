"use client";

import dynamic from "next/dynamic";
import Papa from "papaparse";
import { useCallback, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from "react";
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
  csvPathForVariable,
  normalize,
  schemaErrorFor,
  SCENARIOS,
  type CsvRow,
  type Season,
  type Variable,
  variableTitle
} from "./chartTraces";
import {
  buildIndexTraces,
  climateIndexIntroLines,
  csvPathForIndex,
  indexChartTitle,
  indexHelpLines,
  indexSchemaErrorFor,
  INDEX_OPTIONS,
  INDEX_Y_AXIS_TITLE,
  type ClimateIndex
} from "./indexTraces";
import IndexTabs from "./IndexTabs";
import VariableTabs from "./VariableTabs";

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
/** Vertical gap between collapsed title bars in the collapse-all grid. */
const COLLAPSED_ROW_GAP = 8;
/** Top inset inside the stage (toolbar is already in-flow above the stage). */
const STAGE_TOP = GRID_GAP;

type HelpTopic = "variable" | "index" | "season" | "ecoregion" | "scenarios";
type ChartSource = "variable" | "index";

const CONTROL_HELP: Record<Exclude<HelpTopic, "variable" | "index">, { title: string; body: string[] }> = {
  season: {
    title: "Season",
    body: [
      "This chooses which part of the year the chart summarizes.",
      "Annual uses data for the full year. Winter, spring, summer, and fall each focus on that season only.",
      "Seasonal views help you see whether change is stronger in a particular time of year (for example, hotter summers or wetter winters)."
    ]
  },
  ecoregion: {
    title: "Ecoregion",
    body: [
      "An ecoregion is a geographic area with similar ecosystems, climate, and landscapes. This tool uses EPA Level III ecoregions across North America.",
      "Pick a region from the list, or turn on ecoregion layers on the map and click a region. The chart then shows climate projections for that area only.",
      "Each option is labeled with a code and Level III name. Hover an option to see the broader Level I and Level II context."
    ]
  },
  scenarios: {
    title: "SSP scenarios",
    body: [
      "SSP means Shared Socioeconomic Pathway — a possible future for society, energy use, and greenhouse gas emissions.",
      "Lower numbers (like SSP126) represent lower-emission futures. Higher numbers (like SSP585) represent higher-emission futures with more warming risk.",
      "Check the scenarios you want to compare on the chart. Uncheck any you want to hide so the plot is easier to read."
    ]
  }
};

const USER_GUIDE_STEPS = [
  {
    title: "Set your options",
    body: "In Controls, pick a climate variable or climate index, choose a season for variables, and select SSP scenarios. Tap ? next to a label for more detail."
  },
  {
    title: "Choose an ecoregion",
    body: "Pick a Level III ecoregion from the dropdown, or turn on Ecoregions on the map and click a region. The chart will use that area only."
  },
  {
    title: "Generate a chart",
    body: "Click Generate chart. A plot opens in the chart workspace so you can compare models, means, and scenario spreads."
  },
  {
    title: "Explore and compare",
    body: "Generate more charts to compare. Collapse, expand, or remove them as needed. Use Full map on the sidebar map anytime to return to this home map view."
  }
] as const;

const GUIDE_STORAGE_KEY = "cmip6-user-guide-dismissed";

function subscribeGuideStorage() {
  return () => {};
}

function getGuideDismissedSnapshot() {
  try {
    return sessionStorage.getItem(GUIDE_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function getGuideDismissedServerSnapshot() {
  return false;
}

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
  const [chartSource, setChartSource] = useState<ChartSource>("variable");
  const [variable, setVariable] = useState<Variable>("tas");
  const [climateIndex, setClimateIndex] = useState<ClimateIndex>("trcmax");
  const [season, setSeason] = useState<Season>("annual");
  const [selectedEco, setSelectedEco] = useState("");
  const [enabledScenarios, setEnabledScenarios] = useState<string[]>([...SCENARIOS]);
  const [ecoregions, setEcoregions] = useState<EcoRegion[]>([]);
  const [data, setData] = useState<Partial<Record<Variable, CsvRow[]>>>({});
  const [indexData, setIndexData] = useState<Partial<Record<ClimateIndex, CsvRow[]>>>({});
  const [ecoLoading, setEcoLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState("");
  const [showEcoregions, setShowEcoregions] = useState(false);
  const [mapView, setMapView] = useState({ center: [45, -100] as [number, number], zoom: 3 });
  const [charts, setCharts] = useState<ChartWindowModel[]>([]);
  const [workspaceActive, setWorkspaceActive] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [helpTopic, setHelpTopic] = useState<HelpTopic | null>(null);
  const guideDismissed = useSyncExternalStore(
    subscribeGuideStorage,
    getGuideDismissedSnapshot,
    getGuideDismissedServerSnapshot
  );
  const [guideOverride, setGuideOverride] = useState<boolean | null>(null);
  const guideOpen = guideOverride ?? !guideDismissed;
  const idBase = useId();
  const chartCountRef = useRef(0);
  const zCounterRef = useRef(100);
  const workspaceRef = useRef<HTMLElement | null>(null);

  const toggleHelp = useCallback((topic: HelpTopic) => {
    setHelpTopic((current) => (current === topic ? null : topic));
  }, []);

  const setGuideOpenAndRemember = useCallback((open: boolean) => {
    setGuideOverride(open);
    try {
      if (open) sessionStorage.removeItem(GUIDE_STORAGE_KEY);
      else sessionStorage.setItem(GUIDE_STORAGE_KEY, "1");
    } catch {
      // ignore storage failures
    }
  }, []);

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

  const variableHelp = useMemo(() => [
    "Climate variables are the raw CMIP6 fields used in this tool — mean, max, and min temperature and precipitation.",
    "Charts show changes compared with the near-term past baseline, not absolute amounts.",
    "Mean, max, and min temperature are in degrees Celsius (°C). Precipitation is shown as a percent (%).",
    "Slide between the tabs to pick the variable before generating a chart."
  ], []);

  const indexHelp = useMemo(() => [
    ...climateIndexIntroLines(),
    ...indexHelpLines(climateIndex)
  ], [climateIndex]);

  const selectVariable = useCallback((next: Variable) => {
    setChartSource("variable");
    setVariable(next);
  }, []);

  const selectClimateIndex = useCallback((next: ClimateIndex) => {
    setChartSource("index");
    setClimateIndex(next);
  }, []);

  const handleGenerate = useCallback(async () => {
    setGenerating(true);
    setError("");
    try {
      const indexChart = chartSource === "index";

      if (indexChart) {
        let nextIndexData = indexData;
        const csvPath = csvPathForIndex(climateIndex);
        if (!nextIndexData[climateIndex]?.length) {
          const result = await loadCsv([csvPath]);
          const loaded: Partial<Record<ClimateIndex, CsvRow[]>> = { ...nextIndexData };
          for (const option of INDEX_OPTIONS) {
            if (option.csv === csvPath) loaded[option.id] = result.rows;
          }
          nextIndexData = loaded;
          setIndexData(loaded);
        }

        const rows = nextIndexData[climateIndex] ?? [];
        const schemaError = indexSchemaErrorFor(rows, selectedEco);
        if (schemaError) {
          setError(schemaError);
          return;
        }

        const traces = buildIndexTraces(rows, {
          index: climateIndex,
          selectedEco,
          enabledScenarios: [...enabledScenarios]
        });
        if (!traces.length) {
          setError(`No chart data for ${selectedEco} / ${climateIndex}. Try another region or SSP selection.`);
          return;
        }

        const region = ecoregions.find((item) => item.code === selectedEco);
        const chartIndex = chartCountRef.current;
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
            id: `${idBase}-${chartIndex}`,
            title: indexChartTitle(climateIndex),
            subtitle: region
              ? `${selectedEco} · ${region.level1} · ${region.level2} · ${region.level3}`
              : selectedEco,
            metric: { source: "index", id: climateIndex },
            chartKind: "timeseries",
            yAxisLabel: INDEX_Y_AXIS_TITLE,
            traces,
            x,
            y,
            width,
            height,
            zIndex: zCounterRef.current,
            collapsed: false
          }
        ]);
        return;
      }

      let nextData = data;
      const csvPath = csvPathForVariable(variable);
      if (!nextData[variable]?.length) {
        const result = await loadCsv([csvPath]);
        nextData = { ...nextData, [variable]: result.rows };
        setData(nextData);
      }

      const rows = nextData[variable] ?? [];
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
      if (!traces.length) {
        setError(`No chart data for ${selectedEco} / ${season} / ${variable}. Try another region or season.`);
        return;
      }
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
          metric: { source: "variable", id: variable },
          chartKind: "quarters",
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
  }, [chartSource, climateIndex, data, indexData, variable, season, selectedEco, enabledScenarios, ecoregions, idBase, charts.length]);

  const closeChart = useCallback((id: string) => {
    setCharts((previous) => previous.filter((chart) => chart.id !== id));
  }, []);

  const toggleCollapse = useCallback((id: string) => {
    const stage = workspaceRef.current;
    const stageW = stage?.clientWidth ?? 0;
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
          y: Math.max(0, chart.y),
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
        y: STAGE_TOP + row * (COLLAPSED_HEIGHT + COLLAPSED_ROW_GAP),
        zIndex: 100 + index
      };
    }));
    workspaceRef.current?.scrollTo({ top: 0, behavior: "smooth" });
  }, []);

  const expandAllCharts = useCallback(() => {
    flushSync(() => setSidebarOpen(false));

    const stage = workspaceRef.current;
    // Reflow so clientWidth reflects the full-width workspace after the sidebar closes.
    void stage?.offsetWidth;
    const stageW = stage?.clientWidth ?? 900;
    const gap = GRID_GAP;
    const cols = stageW >= MIN_WINDOW_WIDTH * 2 + gap * 3 ? 2 : 1;
    const layoutWidth = Math.max(
      MIN_WINDOW_WIDTH,
      Math.floor((stageW - gap * (cols + 1)) / cols)
    );
    const layoutHeight = DEFAULT_HEIGHT;

    setCharts((previous) => previous.map((chart, index) => {
      const col = index % cols;
      const row = Math.floor(index / cols);
      return {
        ...chart,
        collapsed: false,
        savedWidth: undefined,
        savedHeight: undefined,
        width: layoutWidth,
        height: layoutHeight,
        x: gap + col * (layoutWidth + gap),
        y: STAGE_TOP + row * (layoutHeight + gap),
        zIndex: 100 + index
      };
    }));
    stage?.scrollTo({ top: 0, behavior: "smooth" });
  }, []);

  const stageContentHeight = useMemo(() => {
    if (!charts.length) return 0;
    return Math.max(
      ...charts.map((chart) => chart.y + (chart.collapsed ? COLLAPSED_HEIGHT : chart.height))
    ) + GRID_GAP;
  }, [charts]);

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
    setCharts((previous) => previous.map((chart) => {
      if (chart.id !== id) return chart;
      return {
        ...chart,
        x: clamp(x, 0, Math.max(0, stageW - chart.width)),
        // Workspace scrolls vertically — keep title bar from going above the stage.
        y: Math.max(0, y)
      };
    }));
  }, []);

  const resizeChart = useCallback((id: string, width: number, height: number) => {
    const stage = workspaceRef.current;
    const stageW = stage?.clientWidth ?? 0;
    setCharts((previous) => previous.map((chart) => {
      if (chart.id !== id || chart.collapsed) return chart;
      return {
        ...chart,
        width: clamp(width, MIN_WINDOW_WIDTH, Math.max(MIN_WINDOW_WIDTH, stageW - chart.x)),
        height: Math.max(MIN_WINDOW_HEIGHT, height)
      };
    }));
  }, []);

  const toggleScenario = (scenario: string) => {
    setEnabledScenarios((previous) => previous.includes(scenario)
      ? previous.filter((item) => item !== scenario)
      : [...previous, scenario]);
  };

  const exitToInitialView = useCallback(() => {
    setWorkspaceActive(false);
    setSidebarOpen(true);
    setMapView({ center: [45, -100], zoom: 3 });
  }, []);

  const canGenerate = !ecoLoading && !!selectedEco && !generating;

  return (
    <main className="shell">
      <header className="hero">
        <div>
          <h1>
            Climate projection explorer
            <span className="hero-intro">Explore how temperature and precipitation may change across North American ecoregions under future climate scenarios in quarters.</span>
          </h1>
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
              <div className="controls-head-actions">
                <button
                  type="button"
                  className={`cursor-pointer text-[11px] font-bold tracking-wide rounded-full px-2.5 py-1 border border-line bg-white text-ink hover:bg-brand-soft ${guideOpen ? "bg-brand-soft text-brand border-brand/30" : ""}`}
                  aria-expanded={guideOpen}
                  aria-controls={`${idBase}-user-guide`}
                  onClick={() => setGuideOpenAndRemember(!guideOpen)}
                >
                  User guide
                </button>
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
            </div>

            {guideOpen ? (
              <div
                id={`${idBase}-user-guide`}
                className="mt-2 rounded-[10px] border border-line bg-brand-soft/50 px-2.5 py-2.5"
                role="region"
                aria-label="User guide"
              >
                <div className="mb-2 flex items-start justify-between gap-2">
                  <div>
                    <p className="m-0 text-[12px] font-bold text-ink">How to get started</p>
                    <p className="m-0 mt-0.5 text-[11px] leading-snug text-muted">
                      Follow these steps to build your first chart.
                    </p>
                  </div>
                  <button
                    type="button"
                    className="icon-btn"
                    aria-label="Dismiss user guide"
                    title="Dismiss"
                    onClick={() => setGuideOpenAndRemember(false)}
                  >
                    ×
                  </button>
                </div>
                <ol className="m-0 flex list-none flex-col gap-2 p-0">
                  {USER_GUIDE_STEPS.map((step, index) => (
                    <li key={step.title} className="flex gap-2">
                      <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-brand text-[10px] font-bold text-white">
                        {index + 1}
                      </span>
                      <div className="min-w-0">
                        <p className="m-0 text-[11px] font-bold text-ink">{step.title}</p>
                        <p className="m-0 mt-0.5 text-[11px] leading-snug text-muted">{step.body}</p>
                      </div>
                    </li>
                  ))}
                </ol>
              </div>
            ) : null}

            <div className={`control-group control-picker${chartSource === "variable" ? " control-picker-active" : ""}`}>
              <div className="control-label-row">
                <label>Climate variable</label>
                <button
                  type="button"
                  className={`help-icon${helpTopic === "variable" ? " active" : ""}`}
                  aria-label="Help: Climate variable"
                  aria-expanded={helpTopic === "variable"}
                  title="Help"
                  onClick={() => toggleHelp("variable")}
                >
                  ?
                </button>
              </div>
              {helpTopic === "variable" ? (
                <div className="control-help" role="region" aria-label="Climate variable help">
                  {variableHelp.map((paragraph) => (
                    <p key={paragraph}>{paragraph}</p>
                  ))}
                </div>
              ) : null}
              <VariableTabs value={variable} onChange={selectVariable} />
            </div>

            <div className={`control-group control-picker${chartSource === "index" ? " control-picker-active" : ""}`}>
              <div className="control-label-row">
                <label>Climate indices</label>
                <button
                  type="button"
                  className={`help-icon${helpTopic === "index" ? " active" : ""}`}
                  aria-label="Help: Climate index"
                  aria-expanded={helpTopic === "index"}
                  title="Help"
                  onClick={() => toggleHelp("index")}
                >
                  ?
                </button>
              </div>
              {helpTopic === "index" ? (
                <div className="control-help" role="region" aria-label="Climate indices help">
                  {indexHelp.map((paragraph) => (
                    <p key={paragraph}>{paragraph}</p>
                  ))}
                </div>
              ) : null}
              <IndexTabs value={climateIndex} onChange={selectClimateIndex} />
            </div>

            {chartSource === "variable" ? (
            <div className="control-group">
              <div className="control-label-row">
                <label htmlFor="season">Season</label>
                <button
                  type="button"
                  className={`help-icon${helpTopic === "season" ? " active" : ""}`}
                  aria-label="Help: Season"
                  aria-expanded={helpTopic === "season"}
                  title="Help"
                  onClick={() => toggleHelp("season")}
                >
                  ?
                </button>
              </div>
              {helpTopic === "season" ? (
                <div className="control-help" role="region" aria-label="Season help">
                  {CONTROL_HELP.season.body.map((paragraph) => (
                    <p key={paragraph}>{paragraph}</p>
                  ))}
                </div>
              ) : null}
              <select id="season" value={season} onChange={(event) => setSeason(event.target.value as Season)}>
                {SEASONS.map((item) => <option key={item} value={item}>{item[0].toUpperCase() + item.slice(1)}</option>)}
              </select>
            </div>
            ) : null}

            <div className="control-group">
              <div className="control-label-row">
                <label htmlFor="ecoregion">Level III ecoregion</label>
                <button
                  type="button"
                  className={`help-icon${helpTopic === "ecoregion" ? " active" : ""}`}
                  aria-label="Help: Ecoregion"
                  aria-expanded={helpTopic === "ecoregion"}
                  title="Help"
                  onClick={() => toggleHelp("ecoregion")}
                >
                  ?
                </button>
              </div>
              {helpTopic === "ecoregion" ? (
                <div className="control-help" role="region" aria-label="Ecoregion help">
                  {CONTROL_HELP.ecoregion.body.map((paragraph) => (
                    <p key={paragraph}>{paragraph}</p>
                  ))}
                </div>
              ) : null}
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
              <div className="control-label-row">
                <label>SSP scenarios</label>
                <button
                  type="button"
                  className={`help-icon${helpTopic === "scenarios" ? " active" : ""}`}
                  aria-label="Help: SSP scenarios"
                  aria-expanded={helpTopic === "scenarios"}
                  title="Help"
                  onClick={() => toggleHelp("scenarios")}
                >
                  ?
                </button>
              </div>
              {helpTopic === "scenarios" ? (
                <div className="control-help" role="region" aria-label="SSP scenarios help">
                  {CONTROL_HELP.scenarios.body.map((paragraph) => (
                    <p key={paragraph}>{paragraph}</p>
                  ))}
                </div>
              ) : null}
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
                  onExitToInitialView={exitToInitialView}
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
                  onExitToInitialView={exitToInitialView}
                  regionLabels={regionLabels}
                />
              </div>
            </section>
          ) : (
            <section className="panel chart-workspace" ref={workspaceRef}>
              <div className="chart-workspace-toolbar">
                {hasCharts ? (
                  <div className="workspace-tool-group">
                    <button type="button" className="workspace-tool-btn" onClick={collapseAllCharts}>
                      Collapse all
                    </button>
                    <button type="button" className="workspace-tool-btn" onClick={expandAllCharts}>
                      Expand all
                    </button>
                  </div>
                ) : <span />}
                <p>Chart workspace: Collapse, expand, or remove charts. Generate more from the sidebar to compare.</p>
                {hasCharts ? (
                  <button type="button" className="workspace-tool-btn workspace-tool-btn-danger" onClick={() => setCharts([])}>
                    Remove all charts ({charts.length})
                  </button>
                ) : <span />}
              </div>
              <div
                className="chart-workspace-stage"
                style={{ height: Math.max(stageContentHeight, 1) }}
              >
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
