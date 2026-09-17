import { normalize, SCENARIOS, type CsvRow } from "./chartTraces";

export type IndexOption = {
  id: string;
  label: string;
  fullName: string;
  column: string;
  minColumn: string;
  maxColumn: string;
  minModelColumn: string;
  maxModelColumn: string;
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
    minModelColumn: "TRCmax_min_model",
    maxModelColumn: "TRCmax_max_model",
    csv: "/data/EcoregionTRC_annual.csv",
    yAxisTitle: "Number of events",
    unitLabel: "events",
    help: [
      "TRCmax is the number of cycles when maximum temperatures rise above 0°C."
    ]
  },
  {
    id: "trcmaxmin",
    label: "TRCmaxmin",
    fullName: "TRCmaxmin (Thaw–Refreeze Cycles)",
    column: "TRCmaxmin",
    minColumn: "TRCmaxmin_min",
    maxColumn: "TRCmaxmin_max",
    minModelColumn: "TRCmaxmin_min_model",
    maxModelColumn: "TRCmaxmin_max_model",
    csv: "/data/EcoregionTRC_annual.csv",
    yAxisTitle: "Number of events",
    unitLabel: "events",
    help: [
      "TRCmaxmin is the number of days when maximum temperatures are above 0°C and minimum temperatures are below 0°C."
    ]
  },
  {
    id: "cddmmean",
    label: "CDDMmean",
    fullName: "CDDMmean — Cumulative Degree Days of Melting",
    column: "CDDMmean",
    minColumn: "CDDMmean_min",
    maxColumn: "CDDMmean_max",
    minModelColumn: "CDDMmean_min_model",
    maxModelColumn: "CDDMmean_max_model",
    csv: "/data/EcoregionCDDM_annual.csv",
    yAxisTitle: "Cumulative degree days (°C·days)",
    unitLabel: "°C·days",
    help: [
      "CDDMmean (Cumulative Degree Days of Melting) is derived from mean temperature with a −3°C threshold."
    ]
  },
  {
    id: "cddmmax",
    label: "CDDMmax",
    fullName: "CDDMmax — Cumulative Degree Days of Melting",
    column: "CDDMmax",
    minColumn: "CDDMmax_min",
    maxColumn: "CDDMmax_max",
    minModelColumn: "CDDMmax_min_model",
    maxModelColumn: "CDDMmax_max_model",
    csv: "/data/EcoregionCDDM_annual.csv",
    yAxisTitle: "Cumulative degree days (°C·days)",
    unitLabel: "°C·days",
    help: [
      "CDDMmax (Cumulative Degree Days of Melting) is derived from maximum temperature with a 0°C threshold."
    ]
  },
  {
    id: "warmspell3",
    label: "WarmSpell3",
    fullName: "WarmSpell3 — Three Consecutive Days Warm Window",
    column: "WarmSpell3",
    minColumn: "WarmSpell3_min",
    maxColumn: "WarmSpell3_max",
    minModelColumn: "WarmSpell3_min_model",
    maxModelColumn: "WarmSpell3_max_model",
    csv: "/data/EcoregionWarmSpell3_annual.csv",
    yAxisTitle: "Number of events",
    unitLabel: "events",
    help: [
      "WarmSpell3 (3-day Warm Spell) counts three consecutive days in a warm window, derived from mean temperature with a 0°C threshold."
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

type YearPoint = {
  mean: number;
  min: number;
  max: number;
  minModel: string;
  maxModel: string;
};

function seriesForScenario(
  rows: CsvRow[],
  scenario: string,
  option: IndexOption
): unknown[] {
  // CSV is already multi-model aggregated: one row per year with model mean / min / max.
  const byYear = new Map<number, YearPoint>();
  for (const row of rows) {
    if (normalize(row.Scenario).toLowerCase() !== scenario.toLowerCase()) continue;
    const year = Number(row.Year);
    const value = Number(row[option.column]);
    const minVal = Number(row[option.minColumn]);
    const maxVal = Number(row[option.maxColumn]);
    if (!Number.isFinite(year) || !Number.isFinite(value)) continue;
    byYear.set(year, {
      mean: value,
      min: minVal,
      max: maxVal,
      minModel: normalize(row[option.minModelColumn]),
      maxModel: normalize(row[option.maxModelColumn])
    });
  }

  const years = Array.from(byYear.keys()).sort((a, b) => a - b);
  if (!years.length) return [];

  const label = scenario === "historical" ? "historical" : scenario.toUpperCase();
  const key = scenario.toLowerCase();
  const color = SCENARIO_COLORS[key] ?? "#697d82";
  const bandColor = SCENARIO_BAND_COLORS[key] ?? "rgba(105, 125, 130, 0.2)";

  const meanY = years.map((year) => byYear.get(year)!.mean);
  const minY = years.map((year) => byYear.get(year)!.min);
  const maxY = years.map((year) => byYear.get(year)!.max);
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
    hovertemplate:
      `${label} ${option.column}<br>` +
      `Year %{x}: %{y:.2f} ${option.unitLabel} (model mean)<br>` +
      `min %{customdata[0]:.2f} (%{customdata[2]}) · max %{customdata[1]:.2f} (%{customdata[3]})<extra></extra>`,
    customdata: years.map((year) => {
      const point = byYear.get(year)!;
      return [point.min, point.max, point.minModel || "min model", point.maxModel || "max model"];
    }),
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
