// ═══════════════════════════════════════════════════════════
// BLISS Lab Chatbot — Supabase DB Migration v4.1
// ═══════════════════════════════════════════════════════════
// Run: node db/migrate.js
// Creates all tables needed for the chatbot in Supabase PostgreSQL
// Tables prefixed with 'chatbot_' to avoid conflicts with ResearchFlow
// ═══════════════════════════════════════════════════════════

const { Pool } = require('pg');

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error('❌ DATABASE_URL 환경변수가 설정되지 않았습니다.');
  process.exit(1);
}

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const MIGRATION_SQL = `
-- ═══════════════════════════════════════════
-- 1. 구성원 (Jarvis Members)
-- ═══════════════════════════════════════════
CREATE TABLE IF NOT EXISTS chatbot_members (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  student_id TEXT,
  researcher_id TEXT,
  email TEXT,
  phone TEXT,
  role TEXT DEFAULT '대학원생',
  annual_leave INTEGER DEFAULT 12,
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ═══════════════════════════════════════════
-- 2. 휴가 기록
-- ═══════════════════════════════════════════
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

-- ═══════════════════════════════════════════
-- 3. FAQ
-- ═══════════════════════════════════════════
CREATE TABLE IF NOT EXISTS chatbot_faq (
  id SERIAL PRIMARY KEY,
  question TEXT NOT NULL,
  answer TEXT,
  keywords TEXT[],
  category TEXT,
  answered_by TEXT,
  answered_date DATE,
  status TEXT DEFAULT '답변완료',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_faq_status ON chatbot_faq(status);

-- ═══════════════════════════════════════════
-- 4. 계정 정보 (Jarvis Accounts)
-- ═══════════════════════════════════════════
CREATE TABLE IF NOT EXISTS chatbot_accounts (
  id SERIAL PRIMARY KEY,
  service_name TEXT NOT NULL,
  login_id TEXT,
  password TEXT,
  url TEXT,
  memo TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ═══════════════════════════════════════════
-- 5. 과제 정보 (Jarvis Projects)
-- ═══════════════════════════════════════════
CREATE TABLE IF NOT EXISTS chatbot_projects (
  id SERIAL PRIMARY KEY,
  project_name TEXT NOT NULL,
  project_number TEXT,
  funding_agency TEXT,
  period TEXT,
  budget TEXT,
  pi TEXT,
  status TEXT DEFAULT '진행중',
  memo TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ═══════════════════════════════════════════
-- 6. 규정/욤뉴얼 (Jarvis Regulations)
-- ═══════════════════════════════════════════
CREATE TABLE IF NOT EXISTS chatbot_regulations (
  id SERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  content TEXT,
  category TEXT,
  source TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ═══════════════════════════════════════════
-- 7. 대화 히스토리 (v4.1 추가)
-- ═══════════════════════════════════════════
CREATE TABLE IF NOT EXISTS chatbot_conversations (
  id SERIAL PRIMARY KEY,
  user_message TEXT NOT NULL,
  bot_response TEXT,
  intent TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_conversations_created ON chatbot_conversations(created_at DESC);

-- ═══════════════════════════════════════════
-- 8. 에러 로그 (v4.1 추가)
-- ═══════════════════════════════════════════
CREATE TABLE IF NOT EXISTS chatbot_error_logs (
  id SERIAL PRIMARY KEY,
  endpoint TEXT,
  error_message TEXT,
  stack TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_error_logs_created ON chatbot_error_logs(created_at DESC);

-- ═══════════════════════════════════════════
-- updated_at 자동 갱신 트리거
-- ═══════════════════════════════════════════
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
    console.log('🚀 Supabase DB 마이그레이션 시작 (v4.1)...');
    await client.query(MIGRATION_SQL);
    console.log('✅ 모든 테이블 생성 완료!');

    // 테이블 목록 확인
    const res = await client.query(`
      SELECT tablename FROM pg_tables
      WHERE tablename LIKE 'chatbot_%'
      ORDER BY tablename
    `);
    console.log('\n📋 생성된 테이블:');
    res.rows.forEach(r => console.log(`   - ${r.tablename}`));

  } catch (err) {
    console.error('❌ 마이그레이션 실패:', err.message);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

migrate().catch(() => process.exit(1));
