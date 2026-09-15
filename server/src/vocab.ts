export type FieldLayer = "official" | "owner" | "either";
export type FieldGroup =
  | "overview"
  | "location"
  | "rules"
  | "records"
  | "profile"
  | "character"
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
  { key: "geometry.kind", label: "Lot lines", group: "location", layer: "official", valueType: "string" },
  { key: "acreage", label: "Acreage", group: "overview", layer: "official", valueType: "acres" },
  { key: "property_class", label: "Property class", group: "overview", layer: "official", valueType: "string" },
  { key: "year_built", label: "Year built", group: "overview", layer: "official", valueType: "number" },
  { key: "building_area", label: "Building area", group: "overview", layer: "official", valueType: "area", unit: "sq ft" },
  { key: "bedrooms", label: "Bedrooms", group: "overview", layer: "official", valueType: "number" },
  { key: "bathrooms", label: "Full bathrooms", group: "overview", layer: "official", valueType: "number" },
  { key: "kitchens", label: "Kitchens", group: "overview", layer: "official", valueType: "number" },
  { key: "building.style", label: "Building style", group: "overview", layer: "official", valueType: "string" },
  { key: "building.heat", label: "Heat (roll)", group: "overview", layer: "official", valueType: "string" },
  { key: "building.fuel", label: "Fuel (roll)", group: "overview", layer: "official", valueType: "string" },
  { key: "lot.frontage", label: "Frontage", group: "overview", layer: "official", valueType: "number", unit: "ft" },
  { key: "lot.depth", label: "Depth", group: "overview", layer: "official", valueType: "number", unit: "ft" },
  { key: "assessment.land", label: "Land assessment", group: "overview", layer: "official", valueType: "money" },
  { key: "assessment.total", label: "Total assessment", group: "overview", layer: "official", valueType: "money" },
  { key: "assessment.county_taxable", label: "County taxable value", group: "overview", layer: "official", valueType: "money" },
  { key: "assessment.town_taxable", label: "Town taxable value", group: "overview", layer: "official", valueType: "money" },
  { key: "assessment.school_taxable", label: "School taxable value", group: "overview", layer: "official", valueType: "money" },
  { key: "market_value_estimate", label: "Full market value", group: "overview", layer: "official", valueType: "money" },
  { key: "exemptions.summary", label: "Exemptions on the roll", group: "overview", layer: "official", valueType: "string" },
  { key: "taxes.county_town", label: "County / town taxes", group: "overview", layer: "official", valueType: "money" },
  { key: "last_sale.date", label: "Last known sale", group: "overview", layer: "official", valueType: "date" },
  { key: "last_sale.price", label: "Last known sale price", group: "overview", layer: "official", valueType: "money" },
  { key: "owner_name_public", label: "Owner of record", group: "overview", layer: "official", valueType: "string" },
  { key: "school_district", label: "School district", group: "location", layer: "official", valueType: "string" },
  { key: "ag.district", label: "Agricultural district", group: "location", layer: "official", valueType: "string" },
  { key: "deed.book", label: "Deed book", group: "records", layer: "official", valueType: "string" },
  { key: "deed.page", label: "Deed page", group: "records", layer: "official", valueType: "string" },
  // "either" fields have no statewide source yet. An official assertion wins when
  // one exists; otherwise the verified owner can fill the blank and the fact is
  // labeled owner-reported rather than presented as official.
  { key: "utility.electric", label: "Electric", group: "location", layer: "either", valueType: "string" },
  { key: "utility.gas", label: "Natural gas", group: "location", layer: "either", valueType: "string" },
  { key: "utility.water", label: "Water", group: "location", layer: "either", valueType: "string" },
  { key: "utility.sewer", label: "Sewer / septic", group: "location", layer: "either", valueType: "string" },
  { key: "utility.internet", label: "Internet provider", group: "location", layer: "either", valueType: "string" },
  { key: "utility.trash", label: "Trash / recycling", group: "location", layer: "either", valueType: "string" },
  { key: "fire_district", label: "Fire district", group: "location", layer: "either", valueType: "string" },
  { key: "zoning.district", label: "Zoning district", group: "rules", layer: "official", valueType: "string" },
  { key: "flood.zone", label: "FEMA flood zone", group: "rules", layer: "official", valueType: "string" },
  { key: "wetlands", label: "Wetlands", group: "rules", layer: "official", valueType: "string" },
  { key: "historic.district", label: "Historic district", group: "rules", layer: "official", valueType: "string" },
  { key: "env.remedial", label: "DEC remedial / brownfield", group: "rules", layer: "official", valueType: "string" },
  { key: "env.bulk_storage", label: "DEC bulk storage", group: "rules", layer: "official", valueType: "string" },
  // The profile group is prose the owner writes about the place itself.
  { key: "profile.summary", label: "About this place", group: "profile", layer: "owner", valueType: "string" },
  // The character group is what people actually ask about when they stop in
  // front of a house: the paint, the style, the trim color. It leads the page;
  // the systems group below is what's in the walls.
  { key: "style.architecture", label: "Architectural style", group: "character", layer: "owner", valueType: "string" },
  { key: "exterior.color", label: "Exterior paint", group: "character", layer: "owner", valueType: "string" },
  { key: "exterior.color.hex", label: "Exterior swatch", group: "character", layer: "owner", valueType: "string" },
  { key: "exterior.trim", label: "Trim color", group: "character", layer: "owner", valueType: "string" },
  { key: "exterior.trim.hex", label: "Trim swatch", group: "character", layer: "owner", valueType: "string" },
  { key: "exterior.door", label: "Front door", group: "character", layer: "owner", valueType: "string" },
  { key: "exterior.door.hex", label: "Door swatch", group: "character", layer: "owner", valueType: "string" },
  { key: "exterior.siding", label: "Siding", group: "character", layer: "owner", valueType: "string" },
  { key: "interior.floors", label: "Floors", group: "character", layer: "owner", valueType: "string" },
  { key: "interior.kitchen", label: "Kitchen", group: "character", layer: "owner", valueType: "string" },
  { key: "interior.palette", label: "Interior palette", group: "character", layer: "owner", valueType: "string" },
  { key: "interior.hardware", label: "Hardware & fixtures", group: "character", layer: "owner", valueType: "string" },
  { key: "original_details", label: "Original details", group: "character", layer: "owner", valueType: "string" },
  { key: "garden", label: "Garden & grounds", group: "character", layer: "owner", valueType: "string" },
  { key: "built_by", label: "Built by", group: "character", layer: "owner", valueType: "string" },
  { key: "house.name", label: "Known as", group: "character", layer: "owner", valueType: "string" },
  // Each topic sheet carries a year, a link, or notes where those make sense.
  { key: "paint.year", label: "Year painted", group: "character", layer: "owner", valueType: "number" },
  { key: "paint.link", label: "Paint link", group: "character", layer: "owner", valueType: "string" },
  { key: "paint.notes", label: "Paint notes", group: "character", layer: "owner", valueType: "string" },
  { key: "style.link", label: "Style link", group: "character", layer: "owner", valueType: "string" },
  { key: "interior.year", label: "Interior last renovated", group: "character", layer: "owner", valueType: "number" },
  { key: "interior.link", label: "Interior link", group: "character", layer: "owner", valueType: "string" },
  { key: "garden.link", label: "Garden link", group: "character", layer: "owner", valueType: "string" },
  { key: "roof.type", label: "Roof", group: "owner", layer: "owner", valueType: "string" },
  { key: "roof.year", label: "Roof year", group: "owner", layer: "owner", valueType: "number" },
  { key: "roof.link", label: "Roof link", group: "owner", layer: "owner", valueType: "string" },
  { key: "heating", label: "Heating", group: "owner", layer: "owner", valueType: "string" },
  { key: "heating.year", label: "Heating system year", group: "owner", layer: "owner", valueType: "number" },
  { key: "cooling", label: "Cooling", group: "owner", layer: "owner", valueType: "string" },
  { key: "cooling.year", label: "Cooling system year", group: "owner", layer: "owner", valueType: "number" },
  { key: "hvac.link", label: "Heating & cooling link", group: "owner", layer: "owner", valueType: "string" },
  { key: "water_heater", label: "Water heater", group: "owner", layer: "owner", valueType: "string" },
  { key: "water_heater.year", label: "Water heater year", group: "owner", layer: "owner", valueType: "number" },
  { key: "electrical", label: "Electrical", group: "owner", layer: "owner", valueType: "string" },
  { key: "electrical.year", label: "Electrical year", group: "owner", layer: "owner", valueType: "number" },
  { key: "septic_or_well", label: "Septic / well", group: "owner", layer: "owner", valueType: "string" },
  { key: "septic.last_service", label: "Septic last serviced", group: "owner", layer: "owner", valueType: "date" },
  { key: "water.link", label: "Water & septic link", group: "owner", layer: "owner", valueType: "string" },
  { key: "windows", label: "Windows", group: "owner", layer: "owner", valueType: "string" },
  { key: "insulation", label: "Insulation", group: "owner", layer: "owner", valueType: "string" },
  { key: "envelope.year", label: "Windows & insulation year", group: "owner", layer: "owner", valueType: "number" },
  { key: "envelope.link", label: "Windows & insulation link", group: "owner", layer: "owner", valueType: "string" },
  { key: "solar", label: "Solar / battery", group: "owner", layer: "owner", valueType: "string" },
  { key: "solar.year", label: "Solar year", group: "owner", layer: "owner", valueType: "number" },
  { key: "power.link", label: "Electrical & solar link", group: "owner", layer: "owner", valueType: "string" },
  { key: "renovations", label: "Renovations", group: "owner", layer: "owner", valueType: "string" },
  { key: "additions", label: "Additions", group: "owner", layer: "owner", valueType: "string" },
  { key: "structures", label: "Other structures", group: "owner", layer: "owner", valueType: "string" },
  { key: "maintenance", label: "Maintenance notes", group: "owner", layer: "owner", valueType: "string" },
];

/**
 * A verified owner may write an owner assertion for any known field. Official
 * government values stay on the public record; the owner fill is labeled
 * owner-reported and only surfaces when no official or inferred value exists.
 */
export function ownerWritable(field: FieldDef | undefined): field is FieldDef {
  return Boolean(field);
}

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
  if (field.valueType === "number" && typeof value === "number" && field.unit) {
    return `${value.toLocaleString("en-US")} ${field.unit}`;
  }
  if (field.valueType === "date") {
    const date = typeof value === "string" ? new Date(value) : value instanceof Date ? value : null;
    if (!date || Number.isNaN(date.getTime())) return String(value);
    return date.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
  }
  return String(value);
}
