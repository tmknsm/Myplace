import { expect, test } from "vitest";
import {
  NONE_FLOOD,
  NONE_HISTORIC,
  NONE_REMEDIAL,
  NONE_TANKS,
  NONE_WETLANDS,
  attr,
  floodZoneRank,
  formatBulkStorage,
  formatFloodZone,
  formatHistoric,
  formatRemedial,
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
  expect(formatHistoric([{ name: "Hudson Historic District", typeId: null }]))
    .toBe("Historic district: Hudson Historic District");
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

test("DEC remedial labels name the site and cap long lists", () => {
  expect(formatRemedial([])).toBe(NONE_REMEDIAL);
  expect(formatRemedial([{ name: "Hudson River PCBs", program: "Superfund", siteClass: "02", siteCode: "546031" }]))
    .toBe("Hudson River PCBs (Superfund, class 02)");
  expect(formatRemedial([
    { name: "Site A", program: "BCP", siteClass: "A", siteCode: "1" },
    { name: "Site B", program: "VCP", siteClass: "C", siteCode: "2" },
    { name: "Site C", program: "ERP", siteClass: "N", siteCode: "3" },
    { name: "Site D", program: "BCP", siteClass: "A", siteCode: "4" },
  ])).toBe("Site A (BCP, class A); Site B (VCP, class C); Site C (ERP, class N); 1 more");
});

test("DEC bulk storage labels the facility program and status", () => {
  expect(formatBulkStorage([])).toBe(NONE_TANKS);
  expect(formatBulkStorage([{
    name: "SWM HOLDINGS US, LLC",
    programType: "CBS",
    status: "Active",
    locality: "ANCRAM",
    programNumber: "4-000081",
  }])).toBe("SWM HOLDINGS US, LLC — chemical bulk storage, Active (ANCRAM)");
});
