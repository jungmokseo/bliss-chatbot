// âââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
// BLISS Lab Chatbot â Supabase DB Migration
// âââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
// Run: node db/migrate.js
// Creates all tables needed for the chatbot in Supabase PostgreSQL
// Tables prefixed with 'chatbot_' to avoid conflicts with ResearchFlow
// âââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ

const { Pool } = require('pg');

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error('â DATABASE_URL íê²½ë³ìê° ì¤ì ëì§ ìììµëë¤.');
  process.exit(1);
}

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const MIGRATION_SQL = `
-- âââââââââââââââââââââââââââââââââââââââââââ
-- 1. êµ¬ì±ì (Jarvis Members)
-- âââââââââââââââââââââââââââââââââââââââââââ
CREATE TABLE IF NOT EXISTS chatbot_members (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  student_id TEXT,
  researcher_id TEXT,
  email TEXT,
  phone TEXT,
  role TEXT DEFAULT 'ëíìì',
  annual_leave INTEGER DEFAULT 12,
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- âââââââââââââââââââââââââââââââââââââââââââ
-- 2. í´ê° ê¸°ë¡
-- âââââââââââââââââââââââââââââââââââââââââââ
CREATE TABLE IF NOT EXISTS chatbot_vacations (
  id SERIAL PRIMARY KEY,
  member_name TEXT NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  days INTEGER NOT NULL DEFAULT 1,
  memo TEXT,
  cancelled BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_vacations_member ON chatbot_vacations(member_name);
CREATE INDEX IF NOT EXISTS idx_vacations_dates ON chatbot_vacations(start_date, end_date);

-- âââââââââââââââââââââââââââââââââââââââââââ
-- 3. FAQ
-- âââââââââââââââââââââââââââââââââââââââââââ
CREATE TABLE IF NOT EXISTS chatbot_faq (
  id SERIAL PRIMARY KEY,
  question TEXT NOT NULL,
  answer TEXT,
  keywords TEXT[],
  category TEXT,
  answered_by TEXT,
  answered_date DATE,
  status TEXT DEFAULT 'ëµë³ìë£',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_faq_status ON chatbot_faq(status);

-- âââââââââââââââââââââââââââââââââââââââââââ
-- 4. ê³ì  ì ë³´ (Jarvis Accounts)
-- âââââââââââââââââââââââââââââââââââââââââââ
CREATE TABLE IF NOT EXISTS chatbot_accounts (
  id SERIAL PRIMARY KEY,
  service_name TEXT NOT NULL,
  login_id TEXT,
  password TEXT,
  url TEXT,
  memo TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- âââââââââââââââââââââââââââââââââââââââââââ
-- 5. ê³¼ì  ì ë³´ (Jarvis Projects)
-- âââââââââââââââââââââââââââââââââââââââââââ
CREATE TABLE IF NOT EXISTS chatbot_projects (
  id SERIAL PRIMARY KEY,
  project_name TEXT NOT NULL,
  project_number TEXT,
  funding_agency TEXT,
  period TEXT,
  budget TEXT,
  pi TEXT,
  status TEXT DEFAULT 'ì§íì¤',
  memo TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- âââââââââââââââââââââââââââââââââââââââââââ
-- 6. ê·ì /ë§¤ë´ì¼ (Jarvis Regulations)
-- âââââââââââââââââââââââââââââââââââââââââââ
CREATE TABLE IF NOT EXISTS chatbot_regulations (
  id SERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  content TEXT,
  category TEXT,
  source TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- âââââââââââââââââââââââââââââââââââââââââââ
-- updated_at ìë ê°±ì  í¸ë¦¬ê±°
-- âââââââââââââââââââââââââââââââââââââââââââ
CREATE OR REPLACE FUNCTION chatbot_update_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_members_updated') THEN
    CREATE TRIGGER trg_members_updated BEFORE UPDATE ON chatbot_members
      FOR EACH ROW EXECUTE FUNCTION chatbot_update_timestamp();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_faq_updated') THEN
    CREATE TRIGGER trg_faq_updated BEFORE UPDATE ON chatbot_faq
      FOR EACH ROW EXECUTE FUNCTION chatbot_update_timestamp();
  END IF;
END $$;
`;

async function migrate() {
  const client = await pool.connect();
  try {
    console.log('ð Supabase DB ë§ì´ê·¸ë ì´ì ìì...');
    await client.query(MIGRATION_SQL);
    console.log('â ëª¨ë  íì´ë¸ ìì± ìë£!');

    // íì´ë¸ ëª©ë¡ íì¸
    const res = await client.query(`
      SELECT tablename FROM pg_tables
      WHERE tablename LIKE 'chatbot_%'
      ORDER BY tablename
    `);
    console.log('\nð ìì±ë íì´ë¸:');
    res.rows.forEach(r => console.log(`   - ${r.tablename}`));

  } catch (err) {
    console.error('â ë§ì´ê·¸ë ì´ì ì¤í¨:', err.message);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

migrate().catch(() => process.exit(1));
