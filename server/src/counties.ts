export type GeometryQuality = "official" | "approximate" | "demonstration";
export type GeometryPolicy = "public" | "restricted";

export interface CountyProfile {
  id: string;
  name: string;
  geometryPolicy: GeometryPolicy;
  center: [number, number];
  zoom: number;
  short: string;
  /** Policy sentence only; the quality sentence is composed from what is actually stored. */
  notice: string;
}

/** Adjacent Hudson River counties that illustrate both NYS polygon cases. */
export const COUNTY_PROFILES: CountyProfile[] = [
  {
    id: "Columbia",
    name: "Columbia County",
    geometryPolicy: "restricted",
    center: [-73.7899, 42.2518],
    zoom: 15.1,
    short: "Does not publish official lot lines.",
    notice: "Columbia County does not authorize NYS to redistribute official tax-map polygons.",
  },
  {
    id: "Greene",
    name: "Greene County",
    geometryPolicy: "public",
    center: [-73.8665, 42.2172],
    zoom: 16,
    short: "Publishes official lot lines through NYS.",
    notice: "Greene County authorized NYS ITS to redistribute official tax-map polygons.",
  },
];

export const DEFAULT_MAP = {
  center: [-73.828, 42.234] as [number, number],
  zoom: 11.6,
};

export const QUALITY_LABEL: Record<GeometryQuality, string> = {
  official: "Official",
  approximate: "Approximate",
  demonstration: "Demonstration",
};

const QUALITY_NOTE: Record<GeometryQuality, string> = {
  official: "These lot lines are the county tax map as published in the NYS Tax Parcels Public dataset.",
  approximate:
    "These lot lines are approximate — an OpenStreetMap building footprint or a rectangle placed from assessment-roll grid coordinates — not the county tax map.",
  demonstration: "These lot lines are a demonstration sketch, not the county tax map.",
};

export function isGeometryQuality(value: unknown): value is GeometryQuality {
  return value === "official" || value === "approximate" || value === "demonstration";
}

export function countyProfile(county: string | null | undefined): CountyProfile | undefined {
  if (!county) return undefined;
  const needle = county.replace(/ county$/i, "").trim();
  return COUNTY_PROFILES.find((item) => item.id.toLowerCase() === needle.toLowerCase());
}

/** Policy + what is actually stored for this parcel. */
export function geometryNotice(county: string | null | undefined, quality: string | null | undefined): string | null {
  const profile = countyProfile(county);
  const detail = isGeometryQuality(quality)
    ? QUALITY_NOTE[quality]
    : "No lot lines are stored for this parcel yet.";
  if (!profile) return detail;
  return `${profile.notice} ${detail}`;
}
