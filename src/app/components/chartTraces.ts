export type CsvRow = Record<string, string | number | null | undefined>;
export type Variable = "tas" | "pr";
export type Season = "annual" | "winter" | "spring" | "summer" | "fall";

export type ChartSnapshot = {
  variable: Variable;
  season: Season;
  selectedEco: string;
  enabledScenarios: string[];
};

export const SCENARIOS = ["ssp126", "ssp245", "ssp370", "ssp585"] as const;
export const PERIODS = ["near-term Past", "near-term Future", "mid-term Future", "long-term Future"] as const;

export const X_LABELS = [
  "Near-term Past",
  "SSP126 Near-term Future", "SSP245 Near-term Future", "SSP370 Near-term Future", "SSP585 Near-term Future",
  "SSP126 Mid-term Future", "SSP245 Mid-term Future", "SSP370 Mid-term Future", "SSP585 Mid-term Future",
  "SSP126 Long-term Future", "SSP245 Long-term Future", "SSP370 Long-term Future", "SSP585 Long-term Future"
];

export const X_POSITIONS = [0, 6, 7, 8, 9, 12, 13, 14, 15, 18, 19, 20, 21];

const SCENARIO_COLORS: Record<string, string> = {
  ssp126: "#d94c4c",
  ssp245: "#3478c7",
  ssp370: "#3b8b62",
  ssp585: "#7654ad"
};

export function normalize(value: unknown): string {
  return String(value ?? "").trim();
}

export function findHeader(headers: string[], candidates: string[]): string | undefined {
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

export function valueColumn(headers: string[], variable: Variable, season: Season): string | undefined {
  const cap = season.charAt(0).toUpperCase() + season.slice(1);
  return findHeader(headers, [
    `Plot_index_${cap}_${variable}`,
    `${cap}_${variable}`,
    `${season}_${variable}`,
    `${variable}_${season}`
  ]);
}

function mean(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function schemaErrorFor(
  rows: CsvRow[],
  variable: Variable,
  season: Season
): string {
  if (!rows.length) return "";
  const headers = Object.keys(rows[0]);
  const ecoHeader = findHeader(headers, ["Ecoregion", "EcoRegion", "EcoregionCode", "Code"]);
  const termHeader = findHeader(headers, ["Term", "Period", "TimePeriod"]);
  const scenarioHeader = findHeader(headers, ["Scenario", "SSP"]);
  const metricHeader = valueColumn(headers, variable, season);
  const missing = [
    !ecoHeader && "ecoregion column",
    !termHeader && "term/period column",
    !scenarioHeader && "scenario column",
    !metricHeader && `${season} ${variable} value column`
  ].filter(Boolean);
  if (!missing.length) return "";
  return `CSV schema mismatch. Missing: ${missing.join(", ")}.\nDetected headers: ${headers.join(", ")}`;
}

export function buildTraces(rows: CsvRow[], snapshot: ChartSnapshot): unknown[] {
  if (!rows.length) return [];
  const headers = Object.keys(rows[0]);
  const ecoHeader = findHeader(headers, ["Ecoregion", "EcoRegion", "EcoregionCode", "Code"]);
  const termHeader = findHeader(headers, ["Term", "Period", "TimePeriod"]);
  const scenarioHeader = findHeader(headers, ["Scenario", "SSP"]);
  const modelHeader = findHeader(headers, ["Model", "GCM", "Source_ID", "Climate_Model"]);
  const metricHeader = valueColumn(headers, snapshot.variable, snapshot.season);
  if (!ecoHeader || !termHeader || !scenarioHeader || !metricHeader) return [];

  const selectedRows = rows.filter((row) => normalize(row[ecoHeader]) === snapshot.selectedEco);
  const output: unknown[] = [];

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
      if (!snapshot.enabledScenarios.includes(scenario)) return;
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
}

export function yAxisTitle(variable: Variable): string {
  return variable === "tas"
    ? "Changes compared with the past (°C)"
    : "Changes compared with the past (%)";
}

export function variableTitle(variable: Variable): string {
  return variable === "tas" ? "Mean temperature" : "Precipitation";
}
