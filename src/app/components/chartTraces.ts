export type CsvRow = Record<string, string | number | null | undefined>;
export type Season = "annual" | "winter" | "spring" | "summer" | "fall";
export type ChartKind = "quarters" | "timeseries";

export const VARIABLE_OPTIONS = [
  { id: "tas", label: "Mean temperature", csv: "/data/EcoregionAve25yearSpan_tas.csv" },
  { id: "pr", label: "Precipitation", csv: "/data/EcoregionAve25yearSpan_pr.csv" }
] as const;

export type Variable = (typeof VARIABLE_OPTIONS)[number]["id"];

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

/** UI season -> tidy-CSV season labels (meteorological). */
export const SEASON_ALIASES: Record<Season, string[]> = {
  annual: ["annual"],
  winter: ["winter", "djf"],
  spring: ["spring", "mam"],
  summer: ["summer", "jja"],
  fall: ["fall", "autumn", "son"]
};

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

function isTidySchema(headers: string[]): boolean {
  const seasonHeader = findHeader(headers, ["season"]);
  const periodHeader = findHeader(headers, ["period", "term", "TimePeriod"]);
  const deltaHeader = findHeader(headers, ["delta"]);
  const pctHeader = findHeader(headers, ["pct_change", "pctchange", "percent_change"]);
  return Boolean(seasonHeader && periodHeader && (deltaHeader || pctHeader));
}

function seasonMatches(rowSeason: string, season: Season): boolean {
  const value = normalize(rowSeason).toLowerCase();
  return SEASON_ALIASES[season].includes(value);
}

function variableSuffixes(variable: Variable): string[] {
  if (variable === "pr") return ["pr", "Pr", "PR"];
  return [variable];
}

/** Wide CSV: Plot_index_{Season}_{variable} columns (EcoregionAve25yearSpan_*). */
export function valueColumn(headers: string[], variable: Variable, season: Season): string | undefined {
  const cap = season.charAt(0).toUpperCase() + season.slice(1);
  for (const suffix of variableSuffixes(variable)) {
    const plotIndex = findHeader(headers, [`Plot_index_${cap}_${suffix}`]);
    if (plotIndex) return plotIndex;
  }
  for (const suffix of variableSuffixes(variable)) {
    const fallback = findHeader(headers, [
      `${cap}_${suffix}`,
      `${season}_${suffix}`,
      `${suffix}_${season}`,
      `Ave25yearSpan_${cap}_${suffix}`
    ]);
    if (fallback) return fallback;
  }
  return undefined;
}

function tidyMetricHeader(headers: string[], variable: Variable): string | undefined {
  if (variable === "pr") {
    return findHeader(headers, ["pct_change", "pctchange", "percent_change"]);
  }
  return findHeader(headers, ["delta"]);
}

function mean(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function isTemperatureVariable(variable: Variable): boolean {
  return variable !== "pr";
}

export function csvPathForVariable(variable: Variable): string {
  return VARIABLE_OPTIONS.find((option) => option.id === variable)?.csv ?? "";
}

export function schemaErrorFor(
  rows: CsvRow[],
  variable: Variable,
  season: Season
): string {
  if (!rows.length) {
    return `Could not load ${variableTitle(variable)} data. Check that ${csvPathForVariable(variable)} is available.`;
  }
  const headers = Object.keys(rows[0]);
  const ecoHeader = findHeader(headers, ["Ecoregion", "EcoRegion", "EcoregionCode", "Code"]);
  const termHeader = findHeader(headers, ["Term", "Period", "TimePeriod"]);
  const scenarioHeader = findHeader(headers, ["Scenario", "SSP"]);

  if (isTidySchema(headers)) {
    const seasonHeader = findHeader(headers, ["season"]);
    const metricHeader = tidyMetricHeader(headers, variable);
    const missing = [
      !ecoHeader && "ecoregion column",
      !termHeader && "term/period column",
      !scenarioHeader && "scenario column",
      !seasonHeader && "season column",
      !metricHeader && (variable === "pr" ? "pct_change column" : "delta column")
    ].filter(Boolean);
    if (missing.length) {
      return `CSV schema mismatch. Missing: ${missing.join(", ")}.\nDetected headers: ${headers.join(", ")}`;
    }
    const hasSeason = rows.some((row) => seasonMatches(normalize(row[seasonHeader!]), season));
    if (!hasSeason) {
      return `No rows for season "${season}" (expected one of: ${SEASON_ALIASES[season].join(", ")}).`;
    }
    return "";
  }

  const metricHeader = valueColumn(headers, variable, season);
  const missing = [
    !ecoHeader && "ecoregion column",
    !termHeader && "term/period column",
    !scenarioHeader && "scenario column",
    !metricHeader && `Plot_index_${season}_${variable} value column`
  ].filter(Boolean);
  if (missing.length) {
    return `CSV schema mismatch. Missing: ${missing.join(", ")}.\nDetected headers: ${headers.join(", ")}`;
  }
  return "";
}

export function buildTraces(rows: CsvRow[], snapshot: ChartSnapshot): unknown[] {
  if (!rows.length) return [];
  const headers = Object.keys(rows[0]);
  const ecoHeader = findHeader(headers, ["Ecoregion", "EcoRegion", "EcoregionCode", "Code"]);
  const termHeader = findHeader(headers, ["Term", "Period", "TimePeriod"]);
  const scenarioHeader = findHeader(headers, ["Scenario", "SSP"]);
  const modelHeader = findHeader(headers, ["Model", "GCM", "Source_ID", "Climate_Model"]);
  if (!ecoHeader || !termHeader || !scenarioHeader) return [];

  const tidy = isTidySchema(headers);
  const seasonHeader = tidy ? findHeader(headers, ["season"]) : undefined;
  const metricHeader = tidy
    ? tidyMetricHeader(headers, snapshot.variable)
    : valueColumn(headers, snapshot.variable, snapshot.season);
  if (!metricHeader) return [];
  if (tidy && !seasonHeader) return [];

  let selectedRows = rows.filter((row) => normalize(row[ecoHeader]) === normalize(snapshot.selectedEco));
  if (tidy) {
    selectedRows = selectedRows.filter((row) =>
      seasonMatches(normalize(row[seasonHeader!]), snapshot.season)
    );
  }
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
  return isTemperatureVariable(variable)
    ? "Changes compared with the past (°C)"
    : "Changes compared with the past (%)";
}

export function variableTitle(variable: Variable): string {
  switch (variable) {
    case "tas":
      return "Mean temperature";
    case "pr":
      return "Precipitation";
  }
}
