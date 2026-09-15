import type { Fact } from "./api";

export type TopicFieldKind = "text" | "multiline" | "year" | "date" | "number" | "link" | "hex";

export interface TopicField {
  key: string;
  /** Label inside the sheet and on the card; falls back to the vocabulary label. */
  label?: string;
  kind?: TopicFieldKind;
  hint?: string;
  /** Take half a row in the sheet instead of the full width. */
  half?: boolean;
}

export type TopicSection = "character" | "systems" | "location";

/**
 * A topic is one sheet's worth of related fields. Paint colors is body, trim,
 * and door plus the year, a link, and notes; Roof is the roof plus its year
 * and a link. The card on the page shows whichever of these are filled in.
 */
export interface Topic {
  id: string;
  section: TopicSection;
  title: string;
  /** One line under the title in the sheet, explaining what belongs here. */
  lede: string;
  /** Empty-state prompt on the owner's page. */
  cta: string;
  fields: TopicField[];
}

const LINK: TopicField = { key: "", label: "Link", kind: "link", hint: "https://", half: true };
const link = (key: string, hint?: string): TopicField => ({ ...LINK, key, hint: hint ?? LINK.hint });

export const TOPICS: Topic[] = [
  {
    id: "paint",
    section: "character",
    title: "Paint colors",
    lede: "Name the colors so nobody has to ask. A hex code next to the name puts a swatch on the page.",
    cta: "Name the paint",
    fields: [
      { key: "exterior.color", label: "Body", hint: "Farrow & Ball Hague Blue", half: true },
      { key: "exterior.color.hex", label: "Hex", kind: "hex", hint: "#30474f", half: true },
      { key: "exterior.trim", label: "Trim", hint: "Benjamin Moore Simply White", half: true },
      { key: "exterior.trim.hex", label: "Hex", kind: "hex", hint: "#f4f2ea", half: true },
      { key: "exterior.door", label: "Front door", hint: "Oxblood, original oak underneath", half: true },
      { key: "exterior.door.hex", label: "Hex", kind: "hex", hint: "#4a0e0e", half: true },
      { key: "paint.year", label: "Year painted", kind: "year", hint: "2022", half: true },
      link("paint.link", "Where you bought it, or the painter"),
      { key: "paint.notes", label: "Notes", kind: "multiline", hint: "Sheen, primer, who did it, how it's held up" },
    ],
  },
  {
    id: "style",
    section: "character",
    title: "Style & history",
    lede: "What kind of house it is and where it came from. The county has the year; you have the rest.",
    cta: "Name the style",
    fields: [
      { key: "style.architecture", label: "Architectural style", hint: "Greek Revival farmhouse, with an 1880s porch" },
      { key: "house.name", label: "Known as", hint: "The blue Victorian", half: true },
      { key: "built_by", label: "Built by", hint: "Local builder; the name is on the 1891 deed", half: true },
      { key: "original_details", label: "Still original", kind: "multiline", hint: "Pocket doors, tin ceiling in the parlor, the clawfoot" },
      link("style.link", "A historic register listing, an old photo"),
    ],
  },
  {
    id: "interior",
    section: "character",
    title: "Inside",
    lede: "Floors, kitchen, palette, hardware. The finishes people ask about after they've been over.",
    cta: "Describe the inside",
    fields: [
      { key: "interior.floors", label: "Floors", hint: "Wide-plank pine upstairs, oak strip below" },
      { key: "interior.kitchen", label: "Kitchen", hint: "Soapstone counters, inset Shaker cabinets" },
      { key: "interior.hardware", label: "Hardware & fixtures", hint: "Unlacquered brass, mostly Rejuvenation" },
      { key: "interior.palette", label: "Palette", kind: "multiline", hint: "Warm whites, one dark green room" },
      { key: "interior.year", label: "Last renovated", kind: "year", hint: "2019", half: true },
      link("interior.link", "The designer, the tile, the source list"),
    ],
  },
  {
    id: "grounds",
    section: "character",
    title: "Garden & grounds",
    lede: "What grows, what's out back, what a new owner should know before the first spring.",
    cta: "Describe the grounds",
    fields: [
      { key: "garden", label: "Garden", kind: "multiline", hint: "Peonies out front, raised beds behind the barn" },
      { key: "structures", label: "Other structures", kind: "multiline", hint: "Barn, shed, the chicken coop" },
      link("garden.link", "A plant list, the landscaper"),
    ],
  },
  {
    id: "roof",
    section: "systems",
    title: "Roof",
    lede: "What's up there and when it went on.",
    cta: "Add the roof",
    fields: [
      { key: "roof.type", label: "Roof", hint: "Standing-seam steel" },
      { key: "roof.year", label: "Year installed", kind: "year", hint: "2018", half: true },
      link("roof.link", "The installer, the warranty"),
    ],
  },
  {
    id: "hvac",
    section: "systems",
    title: "Heating & cooling",
    lede: "How the house stays warm and cool, and how old the equipment is.",
    cta: "Add heating & cooling",
    fields: [
      { key: "heating", label: "Heating", hint: "Oil boiler, hot-water baseboard" },
      { key: "heating.year", label: "Heating installed", kind: "year", hint: "2012", half: true },
      { key: "cooling", label: "Cooling", hint: "Mini-splits" },
      { key: "cooling.year", label: "Cooling installed", kind: "year", hint: "2021", half: true },
      link("hvac.link", "Your HVAC company, the service plan"),
    ],
  },
  {
    id: "water",
    section: "systems",
    title: "Water & septic",
    lede: "Where the water comes from, where it goes, and when the tank was last pumped.",
    cta: "Add water & septic",
    fields: [
      { key: "water_heater", label: "Water heater", hint: "Indirect off the boiler" },
      { key: "water_heater.year", label: "Water heater year", kind: "year", hint: "2016", half: true },
      { key: "septic_or_well", label: "Septic / well", hint: "Drilled well, 1,000-gal septic" },
      { key: "septic.last_service", label: "Septic last serviced", kind: "date", half: true },
      link("water.link", "The septic company, the well report"),
    ],
  },
  {
    id: "power",
    section: "systems",
    title: "Electrical & solar",
    lede: "The panel, the wiring, and anything on the roof making power.",
    cta: "Add electrical & solar",
    fields: [
      { key: "electrical", label: "Electrical", hint: "200 amp, updated 2016" },
      { key: "electrical.year", label: "Electrical year", kind: "year", hint: "2016", half: true },
      { key: "solar", label: "Solar / battery", hint: "7.2 kW array, Enphase, net metered" },
      { key: "solar.year", label: "Solar year", kind: "year", hint: "2023", half: true },
      link("power.link", "The electrician, the solar monitoring page"),
    ],
  },
  {
    id: "envelope",
    section: "systems",
    title: "Windows, siding & insulation",
    lede: "What keeps the weather out.",
    cta: "Add windows & insulation",
    fields: [
      { key: "windows", label: "Windows", hint: "Original double-hung with storms" },
      { key: "exterior.siding", label: "Siding", hint: "Cedar clapboard, painted" },
      { key: "insulation", label: "Insulation", hint: "Dense-pack cellulose in the walls" },
      { key: "envelope.year", label: "Year updated", kind: "year", hint: "2020", half: true },
      link("envelope.link", "The window company, the energy audit"),
    ],
  },
  {
    id: "work",
    section: "systems",
    title: "Renovations & upkeep",
    lede: "The bigger story of what's been done. Log individual jobs under Improvements.",
    cta: "Add renovation notes",
    fields: [
      { key: "renovations", label: "Renovations", kind: "multiline", hint: "Kitchen gutted 2019; upstairs bath 2021" },
      { key: "additions", label: "Additions", kind: "multiline", hint: "Mudroom off the kitchen, 2015" },
      { key: "maintenance", label: "Maintenance notes", kind: "multiline", hint: "Gutters twice a year; boiler serviced every October" },
    ],
  },
  {
    id: "utilities",
    section: "location",
    title: "Utilities & services",
    lede: "Who the bills come from. The county doesn't track this; you can.",
    cta: "Add utilities",
    fields: [
      { key: "utility.electric", label: "Electric", hint: "Central Hudson", half: true },
      { key: "utility.gas", label: "Natural gas", hint: "None; propane tank", half: true },
      { key: "utility.water", label: "Water", hint: "Village water", half: true },
      { key: "utility.sewer", label: "Sewer / septic", hint: "Septic", half: true },
      { key: "utility.internet", label: "Internet", hint: "Spectrum, 300 Mbps", half: true },
      { key: "utility.trash", label: "Trash / recycling", hint: "County Waste, Tuesdays", half: true },
      { key: "fire_district", label: "Fire district", hint: "Claverack Fire District" },
    ],
  },
];

export const TOPIC_BY_ID = new Map(TOPICS.map((topic) => [topic.id, topic]));

const TOPIC_BY_FIELD = new Map<string, Topic>();
for (const topic of TOPICS) for (const field of topic.fields) TOPIC_BY_FIELD.set(field.key, topic);

export function topicForField(fieldKey: string): Topic | undefined {
  return TOPIC_BY_FIELD.get(fieldKey);
}

export function topicsIn(section: TopicSection): Topic[] {
  return TOPICS.filter((topic) => topic.section === section);
}

/** Facts for a topic, in the topic's order. Missing facts are skipped. */
export function topicFacts(topic: Topic, facts: Fact[]): Array<{ field: TopicField; fact: Fact }> {
  const byKey = new Map(facts.map((fact) => [fact.fieldKey, fact]));
  return topic.fields.flatMap((field) => {
    const fact = byKey.get(field.key);
    return fact ? [{ field, fact }] : [];
  });
}

export function filledTopicFacts(topic: Topic, facts: Fact[]): Array<{ field: TopicField; fact: Fact }> {
  return topicFacts(topic, facts).filter(({ field, fact }) => field.kind !== "hex" && fact.status !== "unknown" && fact.display);
}

/** Accept "hudsonpaint.com" as well as a full URL; reject anything that isn't http(s). */
export function normalizeLink(raw: string): string | null {
  const text = raw.trim();
  if (!text) return "";
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `https://${text}`;
  try {
    const url = new URL(withScheme);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (!url.hostname.includes(".")) return null;
    return url.toString();
  } catch {
    return null;
  }
}

export function linkLabel(url: string): string {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^www\./, "");
    const path = parsed.pathname.replace(/\/$/, "");
    return path && path !== "/" ? `${host}${path.length > 24 ? `${path.slice(0, 22)}…` : path}` : host;
  } catch {
    return url;
  }
}
