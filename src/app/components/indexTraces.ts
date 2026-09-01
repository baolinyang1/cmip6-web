import { normalize, SCENARIOS, type CsvRow } from "./chartTraces";

export const INDEX_OPTIONS = [
  { id: "trcmax", label: "TRCmax", column: "TRCmax", csv: "/data/EcoregionTRC_annual.csv" },
  { id: "trcmaxmin", label: "TRCmaxmin", column: "TRCmaxmin", csv: "/data/EcoregionTRC_annual.csv" }
] as const;

export type ClimateIndex = (typeof INDEX_OPTIONS)[number]["id"];

export type IndexSnapshot = {
  index: ClimateIndex;
  selectedEco: string;
  enabledScenarios: string[];
};

export const INDEX_Y_AXIS_TITLE = "Number of events";

export function indexOption(index: ClimateIndex) {
  return INDEX_OPTIONS.find((option) => option.id === index)!;
}

export function indexColumn(index: ClimateIndex): "TRCmax" | "TRCmaxmin" {
  return indexOption(index).column;
}

export function csvPathForIndex(index: ClimateIndex): string {
  return indexOption(index).csv;
}

export function indexChartTitle(index: ClimateIndex): string {
  switch (index) {
    case "trcmax":
      return "TRCmax (Thaw–Refreeze Cycles)";
    case "trcmaxmin":
      return "TRCmaxmin (Thaw–Refreeze Cycles)";
  }
}

export function indexTitle(index: ClimateIndex): string {
  return indexOption(index).label;
}

const INDEX_DESCRIPTIONS: Record<ClimateIndex, string[]> = {
  trcmax: [
    "TRCmax is the number of cycles when maximum temperatures rise above 0°C.",
    "TRC indices could reflect the frequency of warm spells.",
    "Each enabled SSP scenario is plotted as its own line; historical runs through 2014 and projections continue to 2099."
  ],
  trcmaxmin: [
    "TRCmaxmin is the number of days when maximum temperatures are above 0°C and minimum temperatures are below 0°C.",
    "TRCmaxmin specifically captures the immediate fluctuation of temperature around the freezing point.",
    "Each enabled SSP scenario is plotted as its own line; historical runs through 2014 and projections continue to 2099."
  ]
};

const SCENARIO_COLORS: Record<string, string> = {
  historical: "#3478c7",
  ssp126: "#d94c4c",
  ssp245: "#3b8b62",
  ssp370: "#b8894a",
  ssp585: "#7654ad"
};

function mean(values: number[]): number {
  if (!values.length) return Number.NaN;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function seriesForScenario(
  rows: CsvRow[],
  scenario: string,
  column: "TRCmax" | "TRCmaxmin"
): unknown[] {
  const byYear = new Map<number, number[]>();
  for (const row of rows) {
    if (normalize(row.Scenario).toLowerCase() !== scenario.toLowerCase()) continue;
    const year = Number(row.Year);
    const value = Number(row[column]);
    if (!Number.isFinite(year) || !Number.isFinite(value)) continue;
    const bucket = byYear.get(year) ?? [];
    bucket.push(value);
    byYear.set(year, bucket);
  }

  const years = Array.from(byYear.keys()).sort((a, b) => a - b);
  if (!years.length) return [];

  const label = scenario === "historical" ? "historical" : scenario.toUpperCase();
  const y = years.map((year) => mean(byYear.get(year)!));
  const color = SCENARIO_COLORS[scenario.toLowerCase()] ?? "#697d82";

  return [
    {
      type: "scatter",
      mode: "lines",
      name: label,
      x: years,
      y,
      line: { color, width: 2 },
      hovertemplate: `${label} ${column}<br>Year %{x}: %{y:.2f} events<extra></extra>`
    }
  ];
}

export function indexSchemaErrorFor(rows: CsvRow[], selectedEco: string): string {
  if (!rows.length) {
    return "Could not load thaw–refreeze cycle (TRC) data. Check that /data/EcoregionTRC_annual.csv is available.";
  }
  const headers = Object.keys(rows[0]);
  const required = ["Year", "Model", "Ecoregion", "Scenario", "TRCmax", "TRCmaxmin"];
  const missing = required.filter((col) => !headers.includes(col));
  if (missing.length) {
    return `TRC CSV schema mismatch. Expected Year, Model, Ecoregion, Scenario, TRCmax, and TRCmaxmin.\nMissing: ${missing.join(", ")}.\nDetected headers: ${headers.join(", ")}`;
  }
  const hasEco = rows.some((row) => normalize(row.Ecoregion) === normalize(selectedEco));
  if (!hasEco) {
    return `No TRC data for ecoregion ${selectedEco}.`;
  }
  return "";
}

export function buildIndexTraces(rows: CsvRow[], snapshot: IndexSnapshot): unknown[] {
  const option = indexOption(snapshot.index);
  const column = option.column;
  const ecoRows = rows.filter((row) => normalize(row.Ecoregion) === normalize(snapshot.selectedEco));
  const output: unknown[] = [];

  output.push(...seriesForScenario(ecoRows, "historical", column));

  for (const scenario of SCENARIOS) {
    if (!snapshot.enabledScenarios.includes(scenario)) continue;
    output.push(...seriesForScenario(ecoRows, scenario, column));
  }

  return output;
}

export function indexHelpLines(index: ClimateIndex): string[] {
  return INDEX_DESCRIPTIONS[index];
}

export function climateIndexIntroLines(): string[] {
  return [
    "Climate indices are derived metrics — numbers you calculate from daily climate data using rules, not raw fields you download directly.",
    "Pick TRCmax or TRCmaxmin — each generates its own chart with one line per enabled scenario."
  ];
}
