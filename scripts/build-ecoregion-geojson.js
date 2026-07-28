const fs = require("fs");

const src = "d:/cmip6-web/public/data/na_level3_ecoregions.raw.geojson";
const dest = "d:/cmip6-web/public/data/na_level3_ecoregions.geojson";

function extractCode(value) {
  const text = String(value || "").trim();
  const match = text.match(/^(\d+\.\d+\.\d+)/);
  return match ? match[1] : text.split(/\s+/)[0] || "";
}

async function main() {
  const uri =
    "https://map23.epa.gov/ArcGIS/rest/services/Deposition/Overlays/MapServer/2/query?where=1%3D1&outFields=NA_L3KEY,NA_L3NAME&returnGeometry=true&outSR=4326&f=geojson&maxAllowableOffset=0.05";
  console.log("Downloading…");
  const res = await fetch(uri);
  if (!res.ok) throw new Error(`Download failed: ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(src, buf);
  const g = JSON.parse(buf.toString("utf8"));

  const byKey = new Map();
  for (const f of g.features) {
    const code = extractCode(f.properties.NA_L3KEY);
    if (!code || code === "0.0.0") continue; // skip water
    const name = String(f.properties.NA_L3NAME || "").trim();
    if (!byKey.has(code)) {
      byKey.set(code, {
        type: "Feature",
        properties: { code, name },
        geometry: f.geometry
      });
      continue;
    }
    const existing = byKey.get(code);
    const polys = [];
    const push = (geom) => {
      if (!geom) return;
      if (geom.type === "GeometryCollection") geom.geometries.forEach(push);
      else if (geom.type === "MultiPolygon") polys.push(...geom.coordinates);
      else if (geom.type === "Polygon") polys.push(geom.coordinates);
    };
    push(existing.geometry);
    push(f.geometry);
    existing.geometry = { type: "MultiPolygon", coordinates: polys };
    if (name && !existing.properties.name) existing.properties.name = name;
  }

  const merged = {
    type: "FeatureCollection",
    features: [...byKey.values()].sort((a, b) =>
      a.properties.code.localeCompare(b.properties.code, undefined, { numeric: true })
    )
  };
  fs.writeFileSync(dest, JSON.stringify(merged));
  fs.unlinkSync(src);

  const csv = fs
    .readFileSync("d:/cmip6-web/public/data/EcoRegionCode.csv", "utf8")
    .trim()
    .split(/\r?\n/)
    .map((l) => l.split(",")[0].trim())
    .filter((c) => c && c !== "0.0.0");
  const keys = new Set(merged.features.map((f) => f.properties.code));
  const missing = csv.filter((c) => !keys.has(c));
  console.log("merged", merged.features.length, "bytes", fs.statSync(dest).size);
  console.log("missing vs csv", missing.length, missing.slice(0, 10));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
