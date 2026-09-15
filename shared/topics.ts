/** Topic cards on the property page. Keep in sync with web/src/property-topics.ts. */
export const TOPIC_IDS = [
  "paint",
  "style",
  "grounds",
  "roof",
  "hvac",
  "water",
  "power",
  "envelope",
  "work",
  "utilities",
] as const;

export type TopicId = (typeof TOPIC_IDS)[number];

export function isTopicId(value: string): boolean {
  return (TOPIC_IDS as readonly string[]).includes(value);
}
