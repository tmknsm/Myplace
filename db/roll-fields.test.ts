import { expect, test } from "vitest";
import { columbiaExtraFacts, deedRef, exemptionSummary, greeneExtraFacts, positiveMeasure } from "./roll-fields.ts";

test("positiveMeasure drops empty roll zeros", () => {
  expect(positiveMeasure(0)).toBeNull();
  expect(positiveMeasure("0")).toBeNull();
  expect(positiveMeasure(3)).toBe(3);
  expect(positiveMeasure("120")).toBe(120);
});

test("deedRef keeps roll digits and drops zeros", () => {
  expect(deedRef(742)).toBe("742");
  expect(deedRef("338")).toBe("338");
  expect(deedRef(0)).toBeNull();
  expect(deedRef("")).toBeNull();
});

test("exemptionSummary lists the codes that are actually on the roll", () => {
  expect(exemptionSummary({})).toBeNull();
  expect(exemptionSummary({ exemption_code_1: "4185", exemption_code_3: "416D" })).toBe("4185, 416D");
});

test("greeneExtraFacts only emits filled roll cells", () => {
  const facts = Object.fromEntries(greeneExtraFacts({
    NBR_BEDROOMS: 3,
    NBR_FULL_BATHS: 2,
    NBR_KITCHENS: 0,
    BLDG_STYLE_DESC: "Contemporary",
    HEAT_TYPE_DESC: "Hot wtr/stm",
    FUEL_TYPE_DESC: "Oil",
    BOOK: 0,
    PAGE: null,
    AG_DIST_NAME: "Columbia County Ag District 1",
    FRONT: 0,
    DEPTH: 150,
  }));
  expect(facts.bedrooms).toBe(3);
  expect(facts.bathrooms).toBe(2);
  expect(facts.kitchens).toBeUndefined();
  expect(facts["building.style"]).toBe("Contemporary");
  expect(facts["building.heat"]).toBe("Hot wtr/stm");
  expect(facts["building.fuel"]).toBe("Oil");
  expect(facts["deed.book"]).toBeUndefined();
  expect(facts["ag.district"]).toBe("Columbia County Ag District 1");
  expect(facts["lot.frontage"]).toBeUndefined();
  expect(facts["lot.depth"]).toBe(150);
});

test("columbiaExtraFacts labels taxable value, not a tax bill", () => {
  const facts = Object.fromEntries(columbiaExtraFacts({
    deed_book: "615",
    page: "196",
    county_taxable_value: "1299000",
    town_taxable_value: "1299000",
    school_taxable: "0",
    exemption_code_1: "4185",
    front: "0",
    depth: "80",
  }));
  expect(facts["deed.book"]).toBe("615");
  expect(facts["deed.page"]).toBe("196");
  expect(facts["assessment.county_taxable"]).toBe(1_299_000);
  expect(facts["assessment.town_taxable"]).toBe(1_299_000);
  expect(facts["assessment.school_taxable"]).toBe(0);
  expect(facts["exemptions.summary"]).toBe("4185");
  expect(facts["lot.frontage"]).toBeUndefined();
  expect(facts["lot.depth"]).toBe(80);
  expect(facts).not.toHaveProperty("taxes.county_town");
  expect(facts).not.toHaveProperty("last_sale.date");
});
