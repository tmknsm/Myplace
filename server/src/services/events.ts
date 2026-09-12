import { getSql } from "../db.ts";
import { id } from "../ids.ts";

export async function emitEvent(input: {
  propertyId: string;
  eventType: string;
  actorType?: string | null;
  actorId?: string | null;
  sourceId?: string | null;
  payload?: Record<string, unknown>;
  effectiveAt?: Date | string | null;
}): Promise<string> {
  const sql = getSql();
  const eventId = id("evt");
  await sql`
    INSERT INTO property_events (
      event_id, property_id, event_type, actor_type, actor_id, source_id, payload_json, effective_at
    ) VALUES (
      ${eventId}, ${input.propertyId}, ${input.eventType}, ${input.actorType ?? null},
      ${input.actorId ?? null}, ${input.sourceId ?? null}, ${sql.json((input.payload ?? {}) as never)},
      ${input.effectiveAt ?? null}
    )
  `;
  return eventId;
}
