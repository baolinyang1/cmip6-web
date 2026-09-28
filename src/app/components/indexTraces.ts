import { normalize, SCENARIOS, type CsvRow, type Geography } from "./chartTraces";

export type { Geography };

export type IndexOption = {
  id: string;
  label: string;
  fullName: string;
  column: string;
  minColumn: string;
  maxColumn: string;
  minModelColumn: string;
  maxModelColumn: string;
  csv: Record<Geography, string>;
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
    csv: {
      ecoregion: "/data/EcoregionTRC_annual.csv",
      metro: "/data/MetroTRC_annual.csv"
    },
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
    csv: {
      ecoregion: "/data/EcoregionTRC_annual.csv",
      metro: "/data/MetroTRC_annual.csv"
    },
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
    csv: {
      ecoregion: "/data/EcoregionCDDM_annual.csv",
      metro: "/data/MetroCDDM_annual.csv"
    },
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
    csv: {
      ecoregion: "/data/EcoregionCDDM_annual.csv",
      metro: "/data/MetroCDDM_annual.csv"
    },
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
    csv: {
      ecoregion: "/data/EcoregionWarmSpell3_annual.csv",
      metro: "/data/MetroWarmSpell3_annual.csv"
    },
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
  geography: Geography;
  selectedRegion: string;
  enabledScenarios: string[];
};

export function indexOption(index: ClimateIndex): IndexOption {
  return INDEX_OPTIONS.find((option) => option.id === index)!;
}

export function regionColumnFor(geography: Geography): "Ecoregion" | "City" {
  return geography === "metro" ? "City" : "Ecoregion";
}

export function csvPathForIndex(index: ClimateIndex, geography: Geography = "ecoregion"): string {
  return indexOption(index).csv[geography];
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

function withAlpha(hex: string, alpha: number): string {
  const value = Number.parseInt(hex.slice(1), 16);
  const red = (value >> 16) & 255;
  const green = (value >> 8) & 255;
  const blue = value & 255;
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

function darken(hex: string): string {
  const value = Number.parseInt(hex.slice(1), 16);
  const red = Math.round(((value >> 16) & 255) * 0.42);
  const green = Math.round(((value >> 8) & 255) * 0.42);
  const blue = Math.round((value & 255) * 0.42);
  return `rgb(${red}, ${green}, ${blue})`;
}

type YearPoint = {
  mean: number;
  min: number;
  max: number;
  p25: number;
  p50: number;
  p75: number;
  minModel: string;
  maxModel: string;
};

function percentileColumn(column: string, percentile: "p25" | "p50" | "p75"): string {
  return `${column}_${percentile}`;
}

function seriesForScenario(
  rows: CsvRow[],
  scenario: string,
  option: IndexOption
): unknown[] {
  const p25Column = percentileColumn(option.column, "p25");
  const p50Column = percentileColumn(option.column, "p50");
  const p75Column = percentileColumn(option.column, "p75");
  const byYear = new Map<number, YearPoint>();
  for (const row of rows) {
    if (normalize(row.Scenario).toLowerCase() !== scenario.toLowerCase()) continue;
    const year = Number(row.Year);
    const value = Number(row[option.column]);
    if (!Number.isFinite(year) || !Number.isFinite(value)) continue;
    byYear.set(year, {
      mean: value,
      min: Number(row[option.minColumn]),
      max: Number(row[option.maxColumn]),
      p25: Number(row[p25Column]),
      p50: Number(row[p50Column]),
      p75: Number(row[p75Column]),
      minModel: normalize(row[option.minModelColumn]),
      maxModel: normalize(row[option.maxModelColumn])
    });
  }

  const years = Array.from(byYear.keys()).sort((a, b) => a - b);
  if (!years.length) return [];

  const label = scenario === "historical" ? "historical" : scenario.toUpperCase();
  const key = scenario.toLowerCase();
  const color = SCENARIO_COLORS[key] ?? "#697d82";
  const quartileColor = withAlpha(color, 0.4);
  const medianColor = darken(color);

  const points = years.map((year) => byYear.get(year)!);
  const p25Y = points.map((point) => point.p25);
  const p50Y = points.map((point) => point.p50);
  const p75Y = points.map((point) => point.p75);
  const hasQuartiles = points.some(
    (point) => Number.isFinite(point.p25) && Number.isFinite(point.p75)
  );
  const hasMedian = points.some((point) => Number.isFinite(point.p50));
  const hover =
    `${label} ${option.column}<br>` +
    `Year %{x}<br>` +
    `median %{customdata[0]:.2f} ${option.unitLabel}<br>` +
    `p25 %{customdata[1]:.2f} · p75 %{customdata[2]:.2f}<br>` +
    `mean %{customdata[3]:.2f}<br>` +
    `min %{customdata[4]:.2f} (%{customdata[6]}) · max %{customdata[5]:.2f} (%{customdata[7]})<extra></extra>`;
  const customdata = points.map((point) => [
    point.p50,
    point.p25,
    point.p75,
    point.mean,
    point.min,
    point.max,
    point.minModel || "min model",
    point.maxModel || "max model"
  ]);

  const hiddenLine = { color: "transparent", width: 0 };
  const traces: unknown[] = [];

  if (hasQuartiles) {
    traces.push(
      {
        type: "scatter",
        mode: "lines",
        name: `${label} p75`,
        x: years,
        y: p75Y,
        line: hiddenLine,
        hoverinfo: "skip",
        showlegend: false,
        legendgroup: label
      },
      {
        type: "scatter",
        mode: "lines",
        name: `${label} 25–75`,
        x: years,
        y: p25Y,
        fill: "tonexty",
        fillcolor: quartileColor,
        line: hiddenLine,
        hoverinfo: "skip",
        showlegend: false,
        legendgroup: label
      }
    );
  }

  if (hasMedian) {
    traces.push({
      type: "scatter",
      mode: "lines",
      name: label,
      x: years,
      y: p50Y,
      line: { color: medianColor, width: 2.4 },
      hovertemplate: hover,
      customdata,
      legendgroup: label
    });
  }

  return traces;
}

export function indexSchemaErrorFor(
  rows: CsvRow[],
  index: ClimateIndex,
  selectedRegion: string,
  geography: Geography = "ecoregion"
): string {
  const option = indexOption(index);
  const regionColumn = regionColumnFor(geography);
  if (!rows.length) {
    return `Could not load ${option.label} data. Check that ${option.csv[geography]} is available.`;
  }
  const headers = Object.keys(rows[0]);
  const required = [
    "Year",
    regionColumn,
    "Scenario",
    option.column,
    option.minColumn,
    option.maxColumn,
    percentileColumn(option.column, "p25"),
    percentileColumn(option.column, "p50"),
    percentileColumn(option.column, "p75")
  ];
  const missing = required.filter((col) => !headers.includes(col));
  if (missing.length) {
    return `${option.label} CSV schema mismatch. Missing: ${missing.join(", ")}.\nDetected headers: ${headers.join(", ")}`;
  }
  const hasRegion = rows.some((row) => normalize(row[regionColumn]) === normalize(selectedRegion));
  if (!hasRegion) {
    return `No ${option.label} data for ${geography === "metro" ? "city" : "ecoregion"} ${selectedRegion}.`;
  }
  return "";
}

export function buildIndexTraces(rows: CsvRow[], snapshot: IndexSnapshot): unknown[] {
  const option = indexOption(snapshot.index);
  const regionColumn = regionColumnFor(snapshot.geography);
  const regionRows = rows.filter(
    (row) => normalize(row[regionColumn]) === normalize(snapshot.selectedRegion)
  );
  const output: unknown[] = [];

  output.push(...seriesForScenario(regionRows, "historical", option));

  for (const scenario of SCENARIOS) {
    if (!snapshot.enabledScenarios.includes(scenario)) continue;
    output.push(...seriesForScenario(regionRows, scenario, option));
  }

  return output;
}

export function indexHelpLines(index: ClimateIndex): string[] {
  return [...indexOption(index).help];
}
