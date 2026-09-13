export type GeometryQuality = "official" | "demonstration";
export type GeometryPolicy = "public" | "restricted";

export interface CountyProfile {
  id: string;
  name: string;
  geometryPolicy: GeometryPolicy;
  geometryQuality: GeometryQuality;
  center: [number, number];
  zoom: number;
  short: string;
  notice: string;
}

/** Adjacent Hudson River counties that illustrate both NYS polygon cases. */
export const COUNTY_PROFILES: CountyProfile[] = [
  {
    id: "Columbia",
    name: "Columbia County",
    geometryPolicy: "restricted",
    geometryQuality: "demonstration",
    center: [-73.7899, 42.2518],
    zoom: 15.1,
    short: "Does not publish official lot lines.",
    notice:
      "Columbia County does not authorize NYS to redistribute official tax-map polygons. These lot lines are a demonstration sketch, not the county tax map.",
  },
  {
    id: "Greene",
    name: "Greene County",
    geometryPolicy: "public",
    geometryQuality: "official",
    center: [-73.8665, 42.2172],
    zoom: 16,
    short: "Publishes official lot lines through NYS.",
    notice:
      "Greene County authorized NYS ITS to redistribute official tax-map polygons. These lot lines come from the 2025 NYS Tax Parcels Public dataset.",
  },
];

export const DEFAULT_MAP = {
  center: [-73.828, 42.234] as [number, number],
  zoom: 11.6,
};

export function countyProfile(county: string | null | undefined): CountyProfile | undefined {
  if (!county) return undefined;
  const needle = county.replace(/ county$/i, "").trim();
  return COUNTY_PROFILES.find((item) => item.id.toLowerCase() === needle.toLowerCase());
}
