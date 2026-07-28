"use client";

import dynamic from "next/dynamic";
import Papa from "papaparse";
import { useEffect, useMemo, useState } from "react";

const Plot = dynamic(() => import("react-plotly.js"), { ssr: false });

type CsvRow = Record<string, string | number | null | undefined>;
type Variable = "tas" | "pr";
type Season = "annual" | "winter" | "spring" | "summer" | "fall";

type EcoRegion = {
  code: string;
  level1: string;
  level2: string;
  level3: string;
};

const SCENARIOS = ["ssp126", "ssp245", "ssp370", "ssp585"] as const;
const PERIODS = ["near-term Past", "near-term Future", "mid-term Future", "long-term Future"] as const;
const SEASONS: Season[] = ["annual", "winter", "spring", "summer", "fall"];

const X_LABELS = [
  "Near-term Past",
  "SSP126<br>Near-term Future", "SSP245<br>Near-term Future", "SSP370<br>Near-term Future", "SSP585<br>Near-term Future",
  "SSP126<br>Mid-term Future", "SSP245<br>Mid-term Future", "SSP370<br>Mid-term Future", "SSP585<br>Mid-term Future",
  "SSP126<br>Long-term Future", "SSP245<br>Long-term Future", "SSP370<br>Long-term Future", "SSP585<br>Long-term Future"
];

const X_POSITIONS = [0, 6, 7, 8, 9, 12, 13, 14, 15, 18, 19, 20, 21];
const SCENARIO_COLORS: Record<string, string> = {
  ssp126: "#d94c4c",
  ssp245: "#3478c7",
  ssp370: "#3b8b62",
  ssp585: "#7654ad"
};

function normalize(value: unknown): string {
  return String(value ?? "").trim();
}

function findHeader(headers: string[], candidates: string[]): string | undefined {
  const lower = new Map(headers.map((h) => [h.trim().toLowerCase(), h]));
  for (const candidate of candidates) {
    const exact = lower.get(candidate.toLowerCase());
    if (exact) return exact;
  }
  return headers.find((header) => {
    const h = header.toLowerCase();
    return candidates.some((candidate) => h.includes(candidate.toLowerCase()));
  });
}

function valueColumn(headers: string[], variable: Variable, season: Season): string | undefined {
  const cap = season.charAt(0).toUpperCase() + season.slice(1);
  return findHeader(headers, [
    `Plot_index_${cap}_${variable}`,
    `${cap}_${variable}`,
    `${season}_${variable}`,
    `${variable}_${season}`
  ]);
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

function mean(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export default function ClimateDashboard() {
  const [variable, setVariable] = useState<Variable>("tas");
  const [season, setSeason] = useState<Season>("annual");
  const [selectedEco, setSelectedEco] = useState("");
  const [enabledScenarios, setEnabledScenarios] = useState<string[]>([...SCENARIOS]);
  const [ecoregions, setEcoregions] = useState<EcoRegion[]>([]);
  const [data, setData] = useState<Record<Variable, CsvRow[]>>({ tas: [], pr: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    async function loadAll() {
      setLoading(true);
      setError("");
      try {
        const [ecoResult, tasResult, prResult] = await Promise.all([
          loadCsv(["/data/EcoRegionCode.csv"]),
          loadCsv(["/data/Ave25yearSpan_tas.csv", "/data/EcoregionAve25yearSpan_tas.csv"]),
          loadCsv(["/data/Ave25yearSpan_pr.csv", "/data/EcoregionAve25yearSpan_pr.csv"])
        ]);

        const ecoRows = ecoResult.rows.map((row) => {
          const values = Object.values(row).map(normalize);
          return { code: values[0], level1: values[1], level2: values[2], level3: values[3] };
        }).filter((row) => row.code);

        setEcoregions(ecoRows);
        setSelectedEco(ecoRows[0]?.code ?? "");
        setData({ tas: tasResult.rows, pr: prResult.rows });
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoading(false);
      }
    }
    loadAll();
  }, []);

  const currentRows = data[variable];
  const headers = useMemo(() => currentRows.length ? Object.keys(currentRows[0]) : [], [currentRows]);
  const ecoHeader = findHeader(headers, ["Ecoregion", "EcoRegion", "EcoregionCode", "Code"]);
  const termHeader = findHeader(headers, ["Term", "Period", "TimePeriod"]);
  const scenarioHeader = findHeader(headers, ["Scenario", "SSP"]);
  const modelHeader = findHeader(headers, ["Model", "GCM", "Source_ID", "Climate_Model"]);
  const metricHeader = valueColumn(headers, variable, season);

  const schemaError = useMemo(() => {
    if (!currentRows.length) return "";
    const missing = [
      !ecoHeader && "ecoregion column",
      !termHeader && "term/period column",
      !scenarioHeader && "scenario column",
      !metricHeader && `${season} ${variable} value column`
    ].filter(Boolean);
    if (!missing.length) return "";
    return `CSV schema mismatch. Missing: ${missing.join(", ")}.\nDetected headers: ${headers.join(", ")}`;
  }, [currentRows, ecoHeader, termHeader, scenarioHeader, metricHeader, season, variable, headers]);

  const selectedRegion = ecoregions.find((region) => region.code === selectedEco);

  const traces = useMemo(() => {
    if (!ecoHeader || !termHeader || !scenarioHeader || !metricHeader) return [];
    const selectedRows = currentRows.filter((row) => normalize(row[ecoHeader]) === selectedEco);
    const output: any[] = [];

    const pastRows = selectedRows.filter((row) => normalize(row[termHeader]).toLowerCase() === "near-term past");
    const uniquePast = modelHeader
      ? Array.from(new Map(pastRows.map((row) => [normalize(row[modelHeader]), row])).values())
      : pastRows;
    const pastValues = uniquePast.map((row) => Number(row[metricHeader])).filter(Number.isFinite);
    if (pastValues.length) {
      output.push({
        type: "scatter", mode: "markers", name: "Past GCMs", x: Array(pastValues.length).fill(0), y: pastValues,
        text: uniquePast.map((row) => modelHeader ? normalize(row[modelHeader]) : "GCM"),
        hovertemplate: "%{text}<br>%{y:.3f}<extra></extra>",
        marker: { color: "#7d8588", size: 7, opacity: .5, line: { color: "#263238", width: .7 } },
        legendgroup: "past"
      });
      output.push({
        type: "scatter", mode: "markers", name: "Past average", x: [0], y: [mean(pastValues)],
        marker: { color: "#5f6669", size: 15, symbol: "x", line: { width: 2 } },
        hovertemplate: "Past average<br>%{y:.3f}<extra></extra>", legendgroup: "past"
      });
    }

    PERIODS.slice(1).forEach((period, periodIndex) => {
      SCENARIOS.forEach((scenario, scenarioIndex) => {
        if (!enabledScenarios.includes(scenario)) return;
        const x = X_POSITIONS[1 + periodIndex * 4 + scenarioIndex];
        const group = selectedRows.filter((row) =>
          normalize(row[termHeader]).toLowerCase() === period.toLowerCase() &&
          normalize(row[scenarioHeader]).toLowerCase() === scenario
        );
        const values = group.map((row) => Number(row[metricHeader])).filter(Number.isFinite);
        if (!values.length) return;
        const color = SCENARIO_COLORS[scenario];

        output.push({
          type: "violin", name: scenario.toUpperCase(), x: Array(values.length).fill(x), y: values,
          width: 1.0, bandwidth: undefined, points: false, box: { visible: false }, meanline: { visible: false },
          line: { color }, fillcolor: color, opacity: .22, hoverinfo: "skip",
          legendgroup: scenario, showlegend: false
        });
        output.push({
          type: "scatter", mode: "markers", name: scenario.toUpperCase(), x: Array(values.length).fill(x), y: values,
          text: group.map((row) => modelHeader ? normalize(row[modelHeader]) : "GCM"),
          customdata: group.map(() => [period, scenario.toUpperCase()]),
          hovertemplate: "%{text}<br>%{customdata[0]} · %{customdata[1]}<br>%{y:.3f}<extra></extra>",
          marker: { color, size: 7, opacity: .5, line: { color: "#263238", width: .7 } },
          legendgroup: scenario, showlegend: periodIndex === 0
        });
        output.push({
          type: "scatter", mode: "markers", name: `${scenario.toUpperCase()} average`, x: [x], y: [mean(values)],
          marker: { color, size: 15, symbol: "x", line: { width: 2 } },
          hovertemplate: `${scenario.toUpperCase()} average<br>${period}<br>%{y:.3f}<extra></extra>`,
          legendgroup: scenario, showlegend: periodIndex === 0
        });
      });
    });
    return output;
  }, [currentRows, selectedEco, ecoHeader, termHeader, scenarioHeader, modelHeader, metricHeader, enabledScenarios]);

  const toggleScenario = (scenario: string) => {
    setEnabledScenarios((previous) => previous.includes(scenario)
      ? previous.filter((item) => item !== scenario)
      : [...previous, scenario]);
  };

  const yTitle = variable === "tas" ? "Changes compared with the past (°C)" : "Changes compared with the past";
  const variableTitle = variable === "tas" ? "Mean temperature" : "Precipitation";

  return (
    <main className="shell">
      <header className="hero">
        <div>
          <p className="eyebrow">CMIP6 · Level III ecoregions</p>
          <h1>Climate projection explorer</h1>
          <p className="subtitle">Compare individual GCM projections, multi-model averages, and uncertainty distributions across four SSP scenarios and three future 25-year periods.</p>
        </div>
        <div className="hero-note">Small dots are individual climate models. Large X markers are multi-model means. Violin widths show where model projections are concentrated.</div>
      </header>

      <section className="dashboard">
        <aside className="panel controls">
          <h2>Controls</h2>

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
            <select id="ecoregion" value={selectedEco} onChange={(event) => setSelectedEco(event.target.value)}>
              {ecoregions.map((region) => <option key={region.code} value={region.code}>{region.code} — {region.level3}</option>)}
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

          <div className="map-card">
            {/* A normal img is intentional because this is a user-supplied static reference image. */}
            <img src="/data/NA_LEVEL_III.jpg" alt="North American Level III ecoregion reference map" onError={(event) => { event.currentTarget.style.display = "none"; }} />
            <div className="map-caption">SNorth America Level III Ecoregions</div>
          </div>
        </aside>

        <div className="content">
          <section className="panel chart-panel">
            <div className="chart-head">
              <div>
                <h2>{season[0].toUpperCase() + season.slice(1)} {variableTitle} change</h2>
                <p>{selectedEco}{selectedRegion ? ` · ${selectedRegion.level1} · ${selectedRegion.level2} · ${selectedRegion.level3}` : ""}</p>
              </div>
            </div>

            {loading ? <div className="status">Loading climate CSV files…</div> : null}
            {error ? <div className="error">{error}</div> : null}
            {schemaError ? <div className="error">{schemaError}</div> : null}
            {!loading && !error && !schemaError ? (
              <div className="chart-wrap">
                <Plot
                  data={traces}
                  layout={{
                    autosize: true,
                    margin: { l: 76, r: 22, t: 20, b: 145 },
                    paper_bgcolor: "rgba(0,0,0,0)",
                    plot_bgcolor: "rgba(0,0,0,0)",
                    font: { family: "Inter, system-ui, sans-serif", color: "#203039" },
                    hovermode: "closest",
                    violinmode: "overlay",
                    xaxis: {
                      title: { text: "25-year span", font: { size: 35 } },
                      tickmode: "array", tickvals: X_POSITIONS, ticktext: X_LABELS,
                      tickangle: -48, range: [-1.2, 22.2], fixedrange: false,
                      tickfont: { size: 12 },
                      gridcolor: "rgba(105,125,130,.13)", zeroline: false
                    },
                    yaxis: {
                      title: { text: yTitle },
                      range: variable === "tas" ? [-5, 20] : undefined,
                      gridcolor: "rgba(105,125,130,.18)", zerolinecolor: "rgba(70,90,95,.35)"
                    },
                    legend: { orientation: "h", x: .5, xanchor: "center", y: -0.3, yanchor: "top" }
                  }}
                  config={{ responsive: true, displaylogo: false, toImageButtonOptions: { format: "png", filename: `cmip6_${selectedEco}_${variable}_${season}` } }}
                  style={{ width: "100%", height: "100%" }}
                  useResizeHandler
                />
              </div>
            ) : null}
          </section>
        </div>
      </section>
    </main>
  );
}
