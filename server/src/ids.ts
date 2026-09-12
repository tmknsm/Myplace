import { ulid } from "ulid";

export function id(prefix: string): string {
  return `${prefix}_${ulid()}`;
}
