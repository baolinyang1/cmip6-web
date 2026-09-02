import { normalize, SCENARIOS, type CsvRow } from "./chartTraces";

export type IndexOption = {
  id: string;
  label: string;
  fullName: string;
  column: string;
  minColumn: string;
  maxColumn: string;
  csv: string;
  yAxisTitle: string;
  unitLabel: string;
  help: string[];
};

export const INDEX_OPTIONS = [
  {
    id: "trcmax",
    label: "TRCmax",
    fullName: "TRCmax (Thaw–Refreeze Cycles)",
    column: "TRCmax",
    minColumn: "TRCmax_min",
    maxColumn: "TRCmax_max",
    csv: "/data/EcoregionTRC_annual.csv",
    yAxisTitle: "Number of events",
    unitLabel: "events",
    help: [
      "TRCmax is the number of cycles when maximum temperatures rise above 0°C.",
      "TRC indices could reflect the frequency of warm spells.",
      "Each enabled SSP scenario is plotted as its own line, with a lighter band showing the min–max range."
    ]
  },
  {
    id: "trcmaxmin",
    label: "TRCmaxmin",
    fullName: "TRCmaxmin (Thaw–Refreeze Cycles)",
    column: "TRCmaxmin",
    minColumn: "TRCmaxmin_min",
    maxColumn: "TRCmaxmin_max",
    csv: "/data/EcoregionTRC_annual.csv",
    yAxisTitle: "Number of events",
    unitLabel: "events",
    help: [
      "TRCmaxmin is the number of days when maximum temperatures are above 0°C and minimum temperatures are below 0°C.",
      "TRCmaxmin specifically captures the immediate fluctuation of temperature around the freezing point.",
      "Each enabled SSP scenario is plotted as its own line, with a lighter band showing the min–max range."
    ]
  },
  {
    id: "cddmmean",
    label: "CDDMmean",
    fullName: "CDDMmean — Cumulative Degree Days of Melting",
    column: "CDDMmean",
    minColumn: "CDDMmean_min",
    maxColumn: "CDDMmean_max",
    csv: "/data/EcoregionCDDM_annual.csv",
    yAxisTitle: "Cumulative degree days (°C·days)",
    unitLabel: "°C·days",
    help: [
      "CDDMmean is Cumulative Degree Days of Melting derived from mean temperature.",
      "Threshold: −3°C (mean temperature).",
      "Each enabled SSP scenario is plotted as its own line, with a lighter band showing the min–max range."
    ]
  },
  {
    id: "cddmmax",
    label: "CDDMmax",
    fullName: "CDDMmax — Cumulative Degree Days of Melting",
    column: "CDDMmax",
    minColumn: "CDDMmax_min",
    maxColumn: "CDDMmax_max",
    csv: "/data/EcoregionCDDM_annual.csv",
    yAxisTitle: "Cumulative degree days (°C·days)",
    unitLabel: "°C·days",
    help: [
      "CDDMmax is Cumulative Degree Days of Melting derived from maximum temperature.",
      "Threshold: 0°C (maximum temperature).",
      "Each enabled SSP scenario is plotted as its own line, with a lighter band showing the min–max range."
    ]
  },
  {
    id: "warmspell3",
    label: "WarmSpell3",
    fullName: "WarmSpell3 — Three Consecutive Days Warm Window",
    column: "WarmSpell3",
    minColumn: "WarmSpell3_min",
    maxColumn: "WarmSpell3_max",
    csv: "/data/EcoregionWarmSpell3_annual.csv",
    yAxisTitle: "Number of events",
    unitLabel: "events",
    help: [
      "WarmSpell3 (3-day Warm Spell) counts three consecutive days in a warm window.",
      "Derived from mean temperature with a 0°C threshold.",
      "Each enabled SSP scenario is plotted as its own line, with a lighter band showing the min–max range."
    ]
  }
] as const satisfies readonly IndexOption[];

export type ClimateIndex = (typeof INDEX_OPTIONS)[number]["id"];

export type IndexSnapshot = {
  index: ClimateIndex;
  selectedEco: string;
  enabledScenarios: string[];
};

export function indexOption(index: ClimateIndex): IndexOption {
  return INDEX_OPTIONS.find((option) => option.id === index)!;
}

export function csvPathForIndex(index: ClimateIndex): string {
  return indexOption(index).csv;
}

export function indexChartTitle(index: ClimateIndex): string {
  return indexOption(index).fullName;
}

export function indexYAxisTitle(index: ClimateIndex): string {
  return indexOption(index).yAxisTitle;
}

export function indexTitle(index: ClimateIndex): string {
  return indexOption(index).label;
}

const SCENARIO_COLORS: Record<string, string> = {
  historical: "#3478c7",
  ssp126: "#3b8b62",
  ssp245: "#d4b020",
  ssp370: "#7654ad",
  ssp585: "#d94c4c"
};

/** Softer fill colors for min–max bands (same hue family as the line). */
const SCENARIO_BAND_COLORS: Record<string, string> = {
  historical: "rgba(52, 120, 199, 0.22)",
  ssp126: "rgba(59, 139, 98, 0.22)",
  ssp245: "rgba(212, 176, 32, 0.24)",
  ssp370: "rgba(118, 84, 173, 0.22)",
  ssp585: "rgba(217, 76, 76, 0.22)"
};

function mean(values: number[]): number {
  if (!values.length) return Number.NaN;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

type YearBucket = {
  mean: number[];
  min: number[];
  max: number[];
};

function seriesForScenario(
  rows: CsvRow[],
  scenario: string,
  option: IndexOption
): unknown[] {
  const byYear = new Map<number, YearBucket>();
  for (const row of rows) {
    if (normalize(row.Scenario).toLowerCase() !== scenario.toLowerCase()) continue;
    const year = Number(row.Year);
    const value = Number(row[option.column]);
    const minVal = Number(row[option.minColumn]);
    const maxVal = Number(row[option.maxColumn]);
    if (!Number.isFinite(year)) continue;
    const bucket = byYear.get(year) ?? { mean: [], min: [], max: [] };
    if (Number.isFinite(value)) bucket.mean.push(value);
    if (Number.isFinite(minVal)) bucket.min.push(minVal);
    if (Number.isFinite(maxVal)) bucket.max.push(maxVal);
    byYear.set(year, bucket);
  }

  const years = Array.from(byYear.keys()).sort((a, b) => a - b);
  if (!years.length) return [];

  const label = scenario === "historical" ? "historical" : scenario.toUpperCase();
  const key = scenario.toLowerCase();
  const color = SCENARIO_COLORS[key] ?? "#697d82";
  const bandColor = SCENARIO_BAND_COLORS[key] ?? "rgba(105, 125, 130, 0.2)";

  const meanY = years.map((year) => mean(byYear.get(year)!.mean));
  const minY = years.map((year) => mean(byYear.get(year)!.min));
  const maxY = years.map((year) => mean(byYear.get(year)!.max));
  const hasBand = years.some((_, i) => Number.isFinite(minY[i]) && Number.isFinite(maxY[i]));

  const traces: unknown[] = [];

  if (hasBand) {
    traces.push(
      {
        type: "scatter",
        mode: "lines",
        name: `${label} max`,
        x: years,
        y: maxY,
        line: { color: "transparent", width: 0 },
        hoverinfo: "skip",
        showlegend: false,
        legendgroup: label
      },
      {
        type: "scatter",
        mode: "lines",
        name: `${label} range`,
        x: years,
        y: minY,
        fill: "tonexty",
        fillcolor: bandColor,
        line: { color: "transparent", width: 0 },
        hoverinfo: "skip",
        showlegend: false,
        legendgroup: label
      }
    );
  }

  traces.push({
    type: "scatter",
    mode: "lines",
    name: label,
    x: years,
    y: meanY,
    line: { color, width: 2 },
    hovertemplate: `${label} ${option.column}<br>Year %{x}: %{y:.2f} ${option.unitLabel}<br>min %{customdata[0]:.2f} · max %{customdata[1]:.2f}<extra></extra>`,
    customdata: years.map((_, i) => [minY[i], maxY[i]]),
    legendgroup: label
  });

  return traces;
}

export function indexSchemaErrorFor(
  rows: CsvRow[],
  index: ClimateIndex,
  selectedEco: string
): string {
  const option = indexOption(index);
  if (!rows.length) {
    return `Could not load ${option.label} data. Check that ${option.csv} is available.`;
  }
  const headers = Object.keys(rows[0]);
  const required = [
    "Year",
    "Model",
    "Ecoregion",
    "Scenario",
    option.column,
    option.minColumn,
    option.maxColumn
  ];
  const missing = required.filter((col) => !headers.includes(col));
  if (missing.length) {
    return `${option.label} CSV schema mismatch. Missing: ${missing.join(", ")}.\nDetected headers: ${headers.join(", ")}`;
  }
  const hasEco = rows.some((row) => normalize(row.Ecoregion) === normalize(selectedEco));
  if (!hasEco) {
    return `No ${option.label} data for ecoregion ${selectedEco}.`;
  }
  return "";
}

export function buildIndexTraces(rows: CsvRow[], snapshot: IndexSnapshot): unknown[] {
  const option = indexOption(snapshot.index);
  const ecoRows = rows.filter((row) => normalize(row.Ecoregion) === normalize(snapshot.selectedEco));
  const output: unknown[] = [];

  output.push(...seriesForScenario(ecoRows, "historical", option));

  for (const scenario of SCENARIOS) {
    if (!snapshot.enabledScenarios.includes(scenario)) continue;
    output.push(...seriesForScenario(ecoRows, scenario, option));
  }

  return output;
}

export function indexHelpLines(index: ClimateIndex): string[] {
  return [...indexOption(index).help];
}

export function climateIndexIntroLines(): string[] {
  return [
    "Climate indices are derived metrics — numbers you calculate from daily climate data using rules, not raw fields you download directly.",
    "Pick one index — each generates its own chart with one line per enabled scenario and a lighter min–max band."
  ];
}
