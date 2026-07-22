import { neon } from "@neondatabase/serverless";
import type { MeetingBundle } from "./meeting-types";

function database() {
  const url = process.env.OPERATIONS_MEETING_DATABASE_URL || process.env.DATABASE_URL;
  if (!url) throw new Error("OPERATIONS_MEETING_DATABASE_URL または DATABASE_URL が設定されていません。");
  return neon(url);
}

async function ensureSchema(sql: ReturnType<typeof neon>) {
  await sql`
    CREATE TABLE IF NOT EXISTS operations_meetings (
      meeting_id TEXT PRIMARY KEY,
      meeting_date DATE NOT NULL,
      status TEXT NOT NULL,
      agenda_items JSONB NOT NULL DEFAULT '[]'::jsonb,
      meeting_material TEXT NOT NULL DEFAULT '',
      ai_suggestions TEXT NOT NULL DEFAULT '',
      business_status JSONB NOT NULL DEFAULT '{}'::jsonb,
      transcript JSONB NOT NULL DEFAULT '{}'::jsonb,
      minutes JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
}

export async function saveMeetingBundle(bundle: MeetingBundle) {
  const sql = database();
  await ensureSchema(sql);
  const rows = await sql`
    INSERT INTO operations_meetings (
      meeting_id, meeting_date, status, agenda_items, meeting_material,
      ai_suggestions, business_status, transcript, minutes, updated_at
    ) VALUES (
      ${bundle.meetingId}, ${bundle.meetingDate}, ${bundle.status},
      ${JSON.stringify(bundle.agendaItems)}::jsonb, ${bundle.meetingMaterial},
      ${bundle.aiSuggestions}, ${JSON.stringify(bundle.businessStatus)}::jsonb,
      ${JSON.stringify(bundle.transcript)}::jsonb, ${JSON.stringify(bundle.minutes)}::jsonb,
      NOW()
    )
    ON CONFLICT (meeting_id) DO UPDATE SET
      meeting_date = EXCLUDED.meeting_date,
      status = EXCLUDED.status,
      agenda_items = EXCLUDED.agenda_items,
      meeting_material = EXCLUDED.meeting_material,
      ai_suggestions = EXCLUDED.ai_suggestions,
      business_status = EXCLUDED.business_status,
      transcript = EXCLUDED.transcript,
      minutes = EXCLUDED.minutes,
      updated_at = NOW()
    RETURNING updated_at
  `;
  return { updatedAt: new Date(String(rows[0]?.updated_at ?? new Date())).toISOString() };
}

export async function loadMeetingBundle(meetingId: string): Promise<MeetingBundle | null> {
  const sql = database();
  await ensureSchema(sql);
  const rows = await sql`
    SELECT meeting_id, meeting_date, status, agenda_items, meeting_material,
           ai_suggestions, business_status, transcript, minutes, updated_at
    FROM operations_meetings
    WHERE meeting_id = ${meetingId}
    LIMIT 1
  `;
  if (!rows.length) return null;
  const row = rows[0] as Record<string, any>;
  return {
    meetingId: String(row.meeting_id),
    meetingDate: normalizeMeetingDate(row.meeting_date),
    status: row.status === "確定済み" ? "確定済み" : "準備中",
    agendaItems: Array.isArray(row.agenda_items) ? row.agenda_items : [],
    meetingMaterial: String(row.meeting_material ?? ""),
    aiSuggestions: String(row.ai_suggestions ?? ""),
    businessStatus: row.business_status ?? { lowBudgetItems: null, overdueOutsourcingItems: null, overdueIncompleteItems: null, riskReport: null },
    transcript: row.transcript ?? { ai: "", original: "" },
    minutes: row.minutes ?? { aiDraft: "", final: "" },
    updatedAt: new Date(String(row.updated_at)).toISOString(),
  };
}

export async function listStoredMeetings() {
  const sql = database();
  await ensureSchema(sql);
  const rows = await sql`
    SELECT meeting_id, meeting_date, status, updated_at
    FROM operations_meetings
    ORDER BY meeting_date DESC, updated_at DESC
  `;
  return rows.map((row: any) => ({
    id: String(row.meeting_id),
    date: normalizeMeetingDate(row.meeting_date),
    status: String(row.status) === "確定済み" ? "確定済み" : "準備中",
  }));
}
function normalizeMeetingDate(value: unknown) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }

  const text = String(value ?? "");
  const isoDate = text.match(/^(\d{4}-\d{2}-\d{2})/);
  if (isoDate) return isoDate[1];

  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString().slice(0, 10);
}
