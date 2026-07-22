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
);
