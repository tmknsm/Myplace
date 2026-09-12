export type FieldLayer = "official" | "owner" | "either";
export type FieldGroup =
  | "overview"
  | "location"
  | "rules"
  | "records"
  | "owner";

export interface FieldDef {
  key: string;
  label: string;
  group: FieldGroup;
  layer: FieldLayer;
  valueType: "string" | "number" | "money" | "date" | "area" | "acres";
  unit?: string;
}

export const FIELD_VOCAB: FieldDef[] = [
  { key: "address", label: "Address", group: "overview", layer: "official", valueType: "string" },
  { key: "municipality", label: "Municipality", group: "overview", layer: "official", valueType: "string" },
  { key: "county", label: "County", group: "overview", layer: "official", valueType: "string" },
  { key: "parcel.sbl", label: "Parcel ID (SBL)", group: "overview", layer: "official", valueType: "string" },
  { key: "parcel.swis", label: "SWIS", group: "overview", layer: "official", valueType: "string" },
  { key: "acreage", label: "Acreage", group: "overview", layer: "official", valueType: "acres" },
  { key: "property_class", label: "Property class", group: "overview", layer: "official", valueType: "string" },
  { key: "year_built", label: "Year built", group: "overview", layer: "official", valueType: "number" },
  { key: "building_area", label: "Building area", group: "overview", layer: "official", valueType: "area", unit: "sq ft" },
  { key: "assessment.land", label: "Land assessment", group: "overview", layer: "official", valueType: "money" },
  { key: "assessment.total", label: "Total assessment", group: "overview", layer: "official", valueType: "money" },
  { key: "market_value_estimate", label: "Full market value", group: "overview", layer: "official", valueType: "money" },
  { key: "taxes.county_town", label: "County / town taxes", group: "overview", layer: "official", valueType: "money" },
  { key: "last_sale.date", label: "Last known sale", group: "overview", layer: "official", valueType: "date" },
  { key: "last_sale.price", label: "Last known sale price", group: "overview", layer: "official", valueType: "money" },
  { key: "owner_name_public", label: "Owner of record", group: "overview", layer: "official", valueType: "string" },
  { key: "school_district", label: "School district", group: "location", layer: "official", valueType: "string" },
  { key: "utility.electric", label: "Electric", group: "location", layer: "official", valueType: "string" },
  { key: "utility.gas", label: "Natural gas", group: "location", layer: "official", valueType: "string" },
  { key: "utility.water", label: "Water", group: "location", layer: "official", valueType: "string" },
  { key: "utility.sewer", label: "Sewer / septic", group: "location", layer: "official", valueType: "string" },
  { key: "zoning.district", label: "Zoning district", group: "rules", layer: "official", valueType: "string" },
  { key: "flood.zone", label: "FEMA flood zone", group: "rules", layer: "official", valueType: "string" },
  { key: "wetlands", label: "Wetlands", group: "rules", layer: "official", valueType: "string" },
  { key: "historic.district", label: "Historic district", group: "rules", layer: "official", valueType: "string" },
  { key: "roof.type", label: "Roof", group: "owner", layer: "owner", valueType: "string" },
  { key: "roof.year", label: "Roof year", group: "owner", layer: "owner", valueType: "number" },
  { key: "heating", label: "Heating", group: "owner", layer: "owner", valueType: "string" },
  { key: "cooling", label: "Cooling", group: "owner", layer: "owner", valueType: "string" },
  { key: "water_heater", label: "Water heater", group: "owner", layer: "owner", valueType: "string" },
  { key: "electrical", label: "Electrical", group: "owner", layer: "owner", valueType: "string" },
  { key: "septic_or_well", label: "Septic / well", group: "owner", layer: "owner", valueType: "string" },
  { key: "renovations", label: "Renovations", group: "owner", layer: "owner", valueType: "string" },
  { key: "additions", label: "Additions", group: "owner", layer: "owner", valueType: "string" },
  { key: "structures", label: "Other structures", group: "owner", layer: "owner", valueType: "string" },
  { key: "maintenance", label: "Maintenance notes", group: "owner", layer: "owner", valueType: "string" },
];

export const FIELD_BY_KEY = new Map(FIELD_VOCAB.map((field) => [field.key, field]));

export function formatFieldValue(field: FieldDef, value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (field.valueType === "money" && typeof value === "number") {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 0,
    }).format(value);
  }
  if (field.valueType === "acres" && typeof value === "number") {
    return `${value.toLocaleString("en-US", { maximumFractionDigits: 2 })} acres`;
  }
  if (field.valueType === "area" && typeof value === "number") {
    return `${value.toLocaleString("en-US")} ${field.unit ?? ""}`.trim();
  }
  if (field.valueType === "date") {
    const date = typeof value === "string" ? new Date(value) : value instanceof Date ? value : null;
    if (!date || Number.isNaN(date.getTime())) return String(value);
    return date.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
  }
  return String(value);
}
