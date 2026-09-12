CREATE TABLE IF NOT EXISTS keyword_records (
  record_key text PRIMARY KEY,
  category text NOT NULL CHECK (category IN ('economy-business', 'ai', 'travel')),
  head_keyword text NOT NULL,
  status text NOT NULL,
  collected_at timestamptz NOT NULL,
  payload jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (category, head_keyword)
);

CREATE INDEX IF NOT EXISTS keyword_records_status_collected_idx
  ON keyword_records (status, collected_at DESC);

CREATE INDEX IF NOT EXISTS keyword_records_category_collected_idx
  ON keyword_records (category, collected_at DESC);

CREATE TABLE IF NOT EXISTS posts (
  slug text PRIMARY KEY,
  title text NOT NULL,
  description text NOT NULL,
  pub_date date NOT NULL,
  publish_at timestamptz,
  status text NOT NULL CHECK (status IN ('draft', 'scheduled', 'published')),
  topic text NOT NULL,
  angle text NOT NULL,
  author text NOT NULL,
  body_markdown text NOT NULL,
  content_hash text NOT NULL,
  payload jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS posts_status_publish_at_idx
  ON posts (status, publish_at DESC NULLS LAST, pub_date DESC);

CREATE INDEX IF NOT EXISTS posts_topic_publish_at_idx
  ON posts (topic, publish_at DESC NULLS LAST, pub_date DESC);
