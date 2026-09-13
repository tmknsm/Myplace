import { clean, num } from "./lib.ts";

export const GREENE_EXTRA_OUT_FIELDS = [
  "NBR_BEDROOMS",
  "NBR_FULL_BATHS",
  "NBR_KITCHENS",
  "BLDG_STYLE_DESC",
  "HEAT_TYPE_DESC",
  "FUEL_TYPE_DESC",
  "BOOK",
  "PAGE",
  "AG_DIST_NAME",
  "FRONT",
  "DEPTH",
] as const;

export interface GreeneExtraAttrs {
  NBR_BEDROOMS?: number | null;
  NBR_FULL_BATHS?: number | null;
  NBR_KITCHENS?: number | null;
  BLDG_STYLE_DESC?: string | null;
  HEAT_TYPE_DESC?: string | null;
  FUEL_TYPE_DESC?: string | null;
  BOOK?: number | string | null;
  PAGE?: number | string | null;
  AG_DIST_NAME?: string | null;
  FRONT?: number | null;
  DEPTH?: number | null;
}

export type RollRow = Record<string, string | undefined>;

const EXEMPTION_KEYS = Array.from({ length: 10 }, (_, index) => `exemption_code_${index + 1}`);

/** Counts and lot measures of 0 are empty roll cells, not real facts. */
export function positiveMeasure(value: unknown): number | null {
  const n = num(value);
  return n !== null && n > 0 ? n : null;
}

/** Deed book/page 0 is an empty cell. Keep the roll's digits as text. */
export function deedRef(value: unknown): string | null {
  const n = num(value);
  if (n !== null) return n > 0 ? String(n) : null;
  return clean(value);
}

export function exemptionSummary(row: RollRow): string | null {
  const codes = EXEMPTION_KEYS.map((key) => clean(row[key])).filter((code): code is string => Boolean(code));
  return codes.length ? codes.join(", ") : null;
}

function filled(facts: Array<[string, unknown]>): Array<[string, unknown]> {
  return facts.filter(([, value]) => value !== null && value !== undefined && value !== "");
}

export function greeneExtraFacts(a: GreeneExtraAttrs): Array<[string, unknown]> {
  return filled([
    ["bedrooms", positiveMeasure(a.NBR_BEDROOMS)],
    ["bathrooms", positiveMeasure(a.NBR_FULL_BATHS)],
    ["kitchens", positiveMeasure(a.NBR_KITCHENS)],
    ["building.style", clean(a.BLDG_STYLE_DESC)],
    ["building.heat", clean(a.HEAT_TYPE_DESC)],
    ["building.fuel", clean(a.FUEL_TYPE_DESC)],
    ["deed.book", deedRef(a.BOOK)],
    ["deed.page", deedRef(a.PAGE)],
    ["ag.district", clean(a.AG_DIST_NAME)],
    ["lot.frontage", positiveMeasure(a.FRONT)],
    ["lot.depth", positiveMeasure(a.DEPTH)],
  ]);
}

/**
 * Taxable *value* from the ORPTS roll — not the tax bill.
 * Do not map these onto taxes.county_town or last_sale.*.
 */
export function columbiaExtraFacts(row: RollRow): Array<[string, unknown]> {
  return filled([
    ["deed.book", deedRef(row.deed_book)],
    ["deed.page", deedRef(row.page)],
    ["assessment.county_taxable", num(row.county_taxable_value)],
    ["assessment.town_taxable", num(row.town_taxable_value)],
    ["assessment.school_taxable", num(row.school_taxable)],
    ["exemptions.summary", exemptionSummary(row)],
    ["lot.frontage", positiveMeasure(row.front)],
    ["lot.depth", positiveMeasure(row.depth)],
  ]);
}
