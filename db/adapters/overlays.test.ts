import { expect, test } from "vitest";
import {
  NONE_FLOOD,
  NONE_HISTORIC,
  NONE_WETLANDS,
  attr,
  floodZoneRank,
  formatFloodZone,
  formatHistoric,
  formatWetlands,
  formatZoning,
  pickFloodLabel,
} from "./overlays.ts";

test("flood labels prefer SFHA over X and describe the zone", () => {
  expect(formatFloodZone("AE")).toBe("AE — 1% annual-chance floodplain");
  expect(formatFloodZone("X")).toBe("X — minimal flood hazard");
  expect(formatFloodZone("X", "0.2 PCT ANNUAL CHANCE FLOOD HAZARD")).toBe("X — 0.2% annual-chance (500-year)");
  expect(floodZoneRank("VE")).toBeGreaterThan(floodZoneRank("AE"));
  expect(floodZoneRank("AE")).toBeGreaterThan(floodZoneRank("X", "0.2 PCT ANNUAL CHANCE FLOOD HAZARD"));
  expect(pickFloodLabel([
    { zone: "X", subtype: null, sfha: "F" },
    { zone: "AE", subtype: null, sfha: "T" },
  ])).toBe("AE — 1% annual-chance floodplain");
  expect(pickFloodLabel([])).toBe(NONE_FLOOD);
});

test("wetland labels list distinct NWI types or an explicit negative", () => {
  expect(formatWetlands([])).toBe(NONE_WETLANDS);
  expect(formatWetlands(["Freshwater Forested/Shrub Wetland", "Freshwater Pond", "Freshwater Forested/Shrub Wetland"]))
    .toBe("NWI: Freshwater Forested/Shrub Wetland; Freshwater Pond");
});

test("historic labels distinguish districts from individual listings", () => {
  expect(formatHistoric([])).toBe(NONE_HISTORIC);
  expect(formatHistoric([{ name: "Warren Street Historic District", typeId: 3 }]))
    .toBe("Historic district: Warren Street Historic District");
  expect(formatHistoric([{ name: "Olana", typeId: 1 }]))
    .toBe("Listed: Olana (individual National Register listing, not a district)");
  expect(formatHistoric([
    { name: "Warren Street Historic District", typeId: 3 },
    { name: "A house on Warren", typeId: 1 },
  ])).toBe("Historic district: Warren Street Historic District");
});

test("attr reads ArcGIS join-qualified field names", () => {
  expect(attr({ "Wetlands.WETLAND_TYPE": "Freshwater Pond" }, "WETLAND_TYPE")).toBe("Freshwater Pond");
  expect(attr({ FLD_ZONE: "AE" }, "FLD_ZONE")).toBe("AE");
});

test("zoning only formats official Catskill hits and prefers the village", () => {
  expect(formatZoning([])).toBeNull();
  expect(formatZoning([
    { code: "RA", place: "Town of Catskill, 2013 official zoning", priority: 1 },
    { code: "R-2", place: "Village of Catskill zoning", priority: 2 },
  ])).toBe("R-2 (Village of Catskill zoning); RA (Town of Catskill, 2013 official zoning)");
});
