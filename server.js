// ═══════════════════════════════════════════════════════════
// BLISS Lab FAQ 챗봇 v4.1 — Supabase + Gemini AI
// ResearchFlow Validation Application
// + Server-side Auth, Conversation History, FAQ/Member CRUD,
//   Error Logging (Railway deployment)
// ═══════════════════════════════════════════════════════════

const express = require('express');
const { Pool } = require('pg');
const fetch = require('node-fetch');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;

// ─── Middleware ──────────────────────────────────────────
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// ─── PostgreSQL (Supabase) ──────────────────────────────
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});

// ─── 설정 ───────────────────────────────────────────────
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
const CHATBOT_PASSWORD = process.env.CHATBOT_PASSWORD || 'Bliss12!';

// ─── FAQ 캐시 ───────────────────────────────────────────
let faqCache = null;
let faqCacheTime = 0;
const FAQ_CACHE_TTL = 5 * 60 * 1000; // 5분

// ─── 세션 토큰 저장소 (in-memory) ───────────────────────
const activeSessions = new Map(); // token -> { createdAt, expiresAt }
const SESSION_TTL = 24 * 60 * 60 * 1000; // 24시간

function cleanExpiredSessions() {
  const now = Date.now();
  for (const [token, session] of activeSessions) {
    if (now > session.expiresAt) activeSessions.delete(token);
  }
}
setInterval(cleanExpiredSessions, 60 * 60 * 1000); // 1시간마다 정리

// ═══════════════════════════════════════════════════════════
// 에러 로깅 미들웨어
// ═══════════════════════════════════════════════════════════
async function logError(endpoint, errorMessage, stack) {
  try {
    await pool.query(
      `INSERT INTO chatbot_error_logs (endpoint, error_message, stack) VALUES ($1, $2, $3)`,
      [endpoint, errorMessage, stack || null]
    );
  } catch (e) {
    console.error('Error logging failed:', e.message);
  }
}

// ═══════════════════════════════════════════════════════════
// 인증 미들웨어
// ═══════════════════════════════════════════════════════════
function requireAuth(req, res, next) {
  const token = req.headers['x-auth-token'] || req.headers.authorization?.replace('Bearer ', '');
  if (!token || !activeSessions.has(token)) {
    return res.status(401).json({ success: false, error: '인증이 필요합니다.' });
  }
  const session = activeSessions.get(token);
  if (Date.now() > session.expiresAt) {
    activeSessions.delete(token);
    return res.status(401).json({ success: false, error: '세션이 만료되었습니다.' });
  }
  next();
}

// ═══════════════════════════════════════════════════════════
// API Routes — 공개
// ═══════════════════════════════════════════════════════════

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', version: '4.2.0', timestamp: new Date().toISOString() });
});

// ─── 디버그: Gemini API 진단 (배포 후 삭제 가능) ────────
app.get('/api/debug/gemini', async (req, res) => {
  const info = {
    hasApiKey: !!GEMINI_API_KEY,
    apiKeyPrefix: GEMINI_API_KEY ? GEMINI_API_KEY.substring(0, 10) + '...' : 'NOT SET',
    model: GEMINI_MODEL,
    nodeVersion: process.version,
  };

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: 'Reply with just OK' }] }],
        generationConfig: { temperature: 0.1, maxOutputTokens: 10 }
      })
    });
    const result = await response.json();
    info.apiStatus = response.status;
    if (result.error) {
      info.error = result.error;
    } else {
      info.rawResponse = result;
      info.response = result.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || 'empty';
    }
  } catch (err) {
    info.fetchError = err.message;
  }

  res.json(info);
});

// ─── 인증 ─────────────────────────────────────────────
app.post('/api/auth/verify', (req, res) => {
  try {
    const { password } = req.body;
    if (!password) return res.json({ success: false, error: '비밀번호를 입력해주세요.' });

    if (password !== CHATBOT_PASSWORD) {
      return res.json({ success: false, error: '비밀번호가 틀렸습니다.' });
    }

    const token = crypto.randomBytes(32).toString('hex');
    activeSessions.set(token, {
      createdAt: Date.now(),
      expiresAt: Date.now() + SESSION_TTL
    });

    res.json({ success: true, token });
  } catch (err) {
    logError('/api/auth/verify', err.message, err.stack);
    res.json({ success: false, error: '서버 오류' });
  }
});

// ═══════════════════════════════════════════════════════════
// API Routes — 인증 필요
// ═══════════════════════════════════════════════════════════

// ─── 통합 메시지 처리 ──────────────────────────────────
app.post('/api/message', requireAuth, async (req, res) => {
  try {
    const { message } = req.body;
    if (!message || !message.trim()) {
      return res.json({ success: false, error: 'Empty message' });
    }

    // 최근 대화 5개 불러오기
    const history = await getRecentConversations(5);

    const result = await handleMessage(message.trim(), history);

    // 대화 저장
    await saveConversation(message.trim(), result.answer || '', result.intent || 'unknown');

    res.json(result);
  } catch (err) {
    console.error('POST /api/message error:', err.message);
    await logError('/api/message', err.message, err.stack);
    res.json({ success: false, error: '서버 오류가 발생했습니다. 잠시 후 다시 시도해주세요.' });
  }
});

// ─── 휴가 전용 API ──────────────────────────────────────
app.post('/api/vacation/register', requireAuth, async (req, res) => {
  try {
    const { name, start_date, end_date, days, memo } = req.body;
    if (!name || !start_date) {
      return res.json({ success: false, error: '이름과 시작일은 필수입니다.' });
    }
    const result = await vacationRegister(name, start_date, end_date || start_date, days || 1, memo);
    res.json(result);
  } catch (err) {
    await logError('/api/vacation/register', err.message, err.stack);
    res.json({ success: false, error: err.message });
  }
});

app.get('/api/vacation/query', requireAuth, async (req, res) => {
  try {
    const { name } = req.query;
    if (!name) return res.json({ success: false, error: '이름이 필요합니다.' });
    const result = await vacationQuery(name);
    res.json(result);
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

app.get('/api/vacation/all', requireAuth, async (req, res) => {
  try {
    const result = await vacationAll();
    res.json(result);
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

app.post('/api/vacation/cancel', requireAuth, async (req, res) => {
  try {
    const { id } = req.body;
    if (!id) return res.json({ success: false, error: 'id가 필요합니다.' });
    const result = await vacationCancel(id);
    res.json(result);
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

app.get('/api/vacation/list', requireAuth, async (req, res) => {
  try {
    const { name } = req.query;
    if (!name) return res.json({ success: false, error: '이름이 필요합니다.' });
    const result = await vacationListWithIds(name);
    res.json(result);
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

// ─── FAQ API (CRUD) ───────────────────────────────────────
app.get('/api/faq', requireAuth, async (req, res) => {
  try {
    const faqs = await getCachedFaq();
    res.json({ success: true, faq: faqs, count: faqs.length });
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

app.post('/api/faq', requireAuth, async (req, res) => {
  try {
    const { question, answer, keywords, category, answered_by } = req.body;
    if (!question) return res.json({ success: false, error: '질문은 필수입니다.' });
    const status = answer ? '답변완료' : '답변대기';
    const result = await pool.query(
      `INSERT INTO chatbot_faq (question, answer, keywords, category, answered_by, answered_date, status)
       VALUES ($1, $2, $3, $4, $5, CASE WHEN $2 IS NOT NULL THEN CURRENT_DATE ELSE NULL END, $6)
       RETURNING id`,
      [question, answer || null, keywords || null, category || null, answered_by || null, status]
    );
    faqCache = null; // 캐시 무효화
    res.json({ success: true, id: result.rows[0].id, message: 'FAQ가 추가되었습니다.' });
  } catch (err) {
    await logError('POST /api/faq', err.message, err.stack);
    res.json({ success: false, error: err.message });
  }
});

app.put('/api/faq/:id', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { question, answer, keywords, category, answered_by, status } = req.body;
    const result = await pool.query(
      `UPDATE chatbot_faq SET
        question = COALESCE($1, question),
        answer = COALESCE($2, answer),
        keywords = COALESCE($3, keywords),
        category = COALESCE($4, category),
        answered_by = COALESCE($5, answered_by),
        status = COALESCE($6, status),
        answered_date = CASE WHEN $2 IS NOT NULL THEN CURRENT_DATE ELSE answered_date END
       WHERE id = $7 RETURNING id`,
      [question, answer, keywords, category, answered_by, status, id]
    );
    if (result.rows.length === 0) return res.json({ success: false, error: 'FAQ를 찾을 수 없습니다.' });
    faqCache = null;
    res.json({ success: true, message: 'FAQ가 수정되었습니다.' });
  } catch (err) {
    await logError('PUT /api/faq/:id', err.message, err.stack);
    res.json({ success: false, error: err.message });
  }
});

app.delete('/api/faq/:id', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query('DELETE FROM chatbot_faq WHERE id = $1 RETURNING id', [id]);
    if (result.rows.length === 0) return res.json({ success: false, error: 'FAQ를 찾을 수 없습니다.' });
    faqCache = null;
    res.json({ success: true, message: 'FAQ가 삭제되었습니다.' });
  } catch (err) {
    await logError('DELETE /api/faq/:id', err.message, err.stack);
    res.json({ success: false, error: err.message });
  }
});

app.get('/api/faq/unanswered', requireAuth, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, question, created_at FROM chatbot_faq WHERE status = '답변대기' ORDER BY created_at DESC`
    );
    res.json({ success: true, unanswered: result.rows, count: result.rows.length });
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

// ─── 구성원 API (CRUD) ────────────────────────────────────
app.get('/api/members', requireAuth, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, name, student_id, researcher_id, email, phone, role, annual_leave, active FROM chatbot_members ORDER BY name'
    );
    res.json({ success: true, members: result.rows });
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

app.post('/api/members', requireAuth, async (req, res) => {
  try {
    const { name, student_id, researcher_id, email, phone, role, annual_leave } = req.body;
    if (!name) return res.json({ success: false, error: '이름은 필수입니다.' });
    const result = await pool.query(
      `INSERT INTO chatbot_members (name, student_id, researcher_id, email, phone, role, annual_leave)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [name, student_id || null, researcher_id || null, email || null, phone || null, role || '대학원생', annual_leave || 12]
    );
    res.json({ success: true, id: result.rows[0].id, message: `${name} 님이 추가되었습니다.` });
  } catch (err) {
    await logError('POST /api/members', err.message, err.stack);
    res.json({ success: false, error: err.message });
  }
});

app.put('/api/members/:id', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { name, student_id, researcher_id, email, phone, role, annual_leave, active } = req.body;
    const result = await pool.query(
      `UPDATE chatbot_members SET
        name = COALESCE($1, name),
        student_id = COALESCE($2, student_id),
        researcher_id = COALESCE($3, researcher_id),
        email = COALESCE($4, email),
        phone = COALESCE($5, phone),
        role = COALESCE($6, role),
        annual_leave = COALESCE($7, annual_leave),
        active = COALESCE($8, active)
       WHERE id = $9 RETURNING id, name`,
      [name, student_id, researcher_id, email, phone, role, annual_leave, active, id]
    );
    if (result.rows.length === 0) return res.json({ success: false, error: '구성원을 찾을 수 없습니다.' });
    res.json({ success: true, message: `${result.rows[0].name} 님의 정보가 수정되었습니다.` });
  } catch (err) {
    await logError('PUT /api/members/:id', err.message, err.stack);
    res.json({ success: false, error: err.message });
  }
});

app.delete('/api/members/:id', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query('UPDATE chatbot_members SET active = false WHERE id = $1 RETURNING name', [id]);
    if (result.rows.length === 0) return res.json({ success: false, error: '구성원을 찾을 수 없습니다.' });
    res.json({ success: true, message: `${result.rows[0].name} 님이 비활성화되었습니다.` });
  } catch (err) {
    await logError('DELETE /api/members/:id', err.message, err.stack);
    res.json({ success: false, error: err.message });
  }
});

// ─── 관리자 API ─────────────────────────────────────────
app.get('/api/admin/errors', requireAuth, async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 50;
    const result = await pool.query(
      `SELECT id, endpoint, error_message, created_at FROM chatbot_error_logs ORDER BY created_at DESC LIMIT $1`,
      [limit]
    );
    res.json({ success: true, errors: result.rows, count: result.rows.length });
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

app.get('/api/admin/conversations', requireAuth, async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 50;
    const result = await pool.query(
      `SELECT id, user_message, bot_response, intent, created_at FROM chatbot_conversations ORDER BY created_at DESC LIMIT $1`,
      [limit]
    );
    res.json({ success: true, conversations: result.rows, count: result.rows.length });
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

// SPA fallback — admin, chat 등 모두 index.html로
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ═══════════════════════════════════════════════════════════
// 대화 히스토리 관리
// ═══════════════════════════════════════════════════════════
async function saveConversation(userMessage, botResponse, intent) {
  try {
    await pool.query(
      `INSERT INTO chatbot_conversations (user_message, bot_response, intent) VALUES ($1, $2, $3)`,
      [userMessage, (botResponse || '').substring(0, 2000), intent]
    );
  } catch (err) {
    console.error('대화 저장 실패:', err.message);
  }
}

async function getRecentConversations(limit = 5) {
  try {
    const result = await pool.query(
      `SELECT user_message, bot_response, intent FROM chatbot_conversations ORDER BY created_at DESC LIMIT $1`,
      [limit]
    );
    return result.rows.reverse(); // 시간순 정렬
  } catch (err) {
    return [];
  }
}

// ═══════════════════════════════════════════════════════════
// 통합 메시지 핸들러 — Gemini Intent 분류 → 실행
// ═══════════════════════════════════════════════════════════
async function handleMessage(message, history) {
  // Step 1: Gemini로 intent 분류
  const classification = await classifyIntent(message, history);

  if (!classification || !classification.intent) {
    return await handleFaqSearch(message, history);
  }

  // Step 2: intent별 실행
  switch (classification.intent) {
    case 'vacation_register':
      return await handleVacationRegisterAI(classification.entities, message);
    case 'vacation_query':
      return await handleVacationQueryAI(classification.entities);
    case 'vacation_all':
      return await vacationAll();
    case 'member_info':
      return await handleMemberInfo(classification.entities, message);
    case 'account_info':
      return await handleAccountInfo(classification.entities, message);
    case 'project_info':
      return await handleProjectInfo(classification.entities, message);
    case 'regulation_info':
      return await handleRegulationInfo(classification.entities, message);
    case 'faq_search':
    default:
      return await handleFaqSearch(message, history);
  }
}

// ═══════════════════════════════════════════════════════════
// Gemini Intent 분류기
// ═══════════════════════════════════════════════════════════
async function classifyIntent(message, history) {
  if (!GEMINI_API_KEY) return null;

  const now = new Date();
  const todayISO = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const year = now.getFullYear();

  // 대화 히스토리 컨텍스트
  let historyContext = '';
  if (history && history.length > 0) {
    historyContext = '\n\n최근 대화 히스토리 (참고용):\n' +
      history.map(h => `사용자: ${h.user_message}\n봇: ${(h.bot_response || '').substring(0, 100)}`).join('\n---\n');
  }

  const prompt = `당신은 한국 연구실 챗봇의 intent 분류기입니다.

사용자 메시지를 분석하여 intent와 entity를 추출하세요.

가능한 intent:
- vacation_register: 휴가를 등록/신청/기록하려는 경우. "등록", "신청", "쓸게", "쓰겠습니다", "내다", "연차" 등의 표현 포함.
  예시: "정윤민 2월 27일 휴가 등록", "박시연 휴가 4월 15-17일 등록", "3월 5일 휴가 쓸게요 김태영", "김태영 3월 5일 연차"
- vacation_query: 휴가 잔여일/사용현황을 조회하려는 경우. "조회", "남았", "며칠", "확인", "현황", "얼마나" 등.
  예시: "홍길동 휴가 조회", "내 휴가 며칠 남았어?", "박시연 휴가 현황"
- vacation_all: 전체 구성원의 휴가 현황 요약. "전체", "모든 사람" 등.
  예시: "전체 휴가 현황", "휴가 전체", "모든 학생 휴가"
- member_info: 특정 구성원의 인적사항(학번, 이메일, 전화번호, 연구자등록번호 등) 조회.
  예시: "김태영 학번", "이유림 이메일", "정윤민 연락처"
- account_info: 연구실 공용 계정/비밀번호/로그인 정보 조회.
  예시: "아고다 계정", "SEM 예약 계정"
- project_info: 연구과제 정보 조회.
  예시: "현재 진행중인 과제", "NRF 과제번호"
- regulation_info: 연구비/출장비/여비 규정 관련 질문.
  예시: "출장비 규정", "식대 한도"
- faq_search: 위 어디에도 해당하지 않는 일반 질문.

엔티티 추출 규칙:
- name: 한국 이름 (2~4글자 한글) 또는 영문 이름. 메시지에서 사람 이름을 찾으세요.
- start_date: YYYY-MM-DD 형식. 연도 없으면 ${year}년.
- end_date: YYYY-MM-DD. 단일 날짜면 start_date와 동일. "15-17일"이면 start=15일, end=17일.
- days: 시작~종료 포함 일수 (end - start + 1). 반드시 정확히 계산하세요.
- keyword: account_info/project_info/regulation_info용 검색 키워드.

오늘 날짜: ${todayISO}
${historyContext}

반드시 아래 JSON만 출력 (다른 텍스트 없이):
{"intent":"<intent>","confidence":<0~1>,"entities":{...}}

메시지: ${message}`;

  try {
    const resp = await geminiCall(prompt, 0.1, 300);
    if (!resp) return null;

    const jsonMatch = resp.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;

    const parsed = JSON.parse(jsonMatch[0]);
    console.log(`[Intent] ${parsed.intent} (${parsed.confidence}) | Entities:`, JSON.stringify(parsed.entities));
    return parsed;
  } catch (err) {
    console.error('classifyIntent error:', err.message);
    return null;
  }
}

// ═══════════════════════════════════════════════════════════
// 휴가 관리 — SQL 기반 (핵심 안정성 보장)
// ═══════════════════════════════════════════════════════════

async function handleVacationRegisterAI(entities, originalMessage) {
  if (!entities) {
    return fail('휴가 등록 정보를 파악하지 못했습니다.\n\n예시: "정윤민 3월 27일 휴가 등록"');
  }

  const { name, start_date, end_date, days } = entities;
  if (!name) return fail('이름을 인식하지 못했습니다.\n\n예시: "정윤민 3월 27일 휴가 등록"');
  if (!start_date) return fail(`${name} 님의 휴가 날짜를 인식하지 못했습니다.\n\n예시: "${name} 3월 27일 휴가 등록"`);

  return await vacationRegister(name, start_date, end_date || start_date, days || 1);
}

async function vacationRegister(name, startDate, endDate, days, memo) {
  await pool.query(
    `INSERT INTO chatbot_vacations (member_name, start_date, end_date, days, memo)
     VALUES ($1, $2, $3, $4, $5)`,
    [name, startDate, endDate, days, memo || null]
  );

  const stats = await getVacationStats(name);

  const sm = parseInt(startDate.split('-')[1]);
  const sd = parseInt(startDate.split('-')[2]);
  const ed = parseInt(endDate.split('-')[2]);
  const dateStr = (startDate === endDate)
    ? `${sm}월 ${sd}일 (1일)`
    : `${sm}월 ${sd}일 ~ ${ed}일 (${days}일)`;

  return {
    success: true, matched: true, intent: 'vacation_register',
    answer: `<strong>${name}</strong> 님의 휴가가 등록되었습니다.\n\n📅 기간: ${dateStr}\n📊 연간 ${stats.annual}일 중 ${stats.used}일 사용 → <strong>잔여 ${stats.remaining}일</strong>`,
    extra: '<div class="registered-tag">✅ DB에 등록 완료</div>',
    meta: { registered: true },
    annual: stats.annual, usedDays: stats.used, remaining: stats.remaining
  };
}

async function handleVacationQueryAI(entities) {
  if (!entities || !entities.name) {
    return fail('이름을 인식하지 못했습니다.\n\n예시: "홍길동 휴가 조회"');
  }
  return await vacationQuery(entities.name);
}

async function vacationQuery(name) {
  const stats = await getVacationStats(name);

  if (stats.records.length === 0) {
    return {
      success: true, matched: true, intent: 'vacation_query',
      answer: `<strong>${name}</strong> 님의 휴가 사용 내역이 없습니다.\n\n연간 할당 ${stats.annual}일 전부 사용 가능합니다.`,
      extra: '', meta: {},
      annual: stats.annual, usedDays: 0, remaining: stats.annual, records: []
    };
  }

  const usedList = stats.records.map(r => {
    const s = r.start_date.slice(5).replace('-', '월 ') + '일';
    const e = r.end_date.slice(5).replace('-', '월 ') + '일';
    const memo = r.memo ? ` (${r.memo})` : '';
    return r.start_date === r.end_date
      ? `  • ${s} (${r.days}일)${memo}`
      : `  • ${s} ~ ${e} (${r.days}일)${memo}`;
  }).join('\n');

  const card = `<div class="vacation-card">
    <div class="vc-row"><span class="vc-label">연간 할당</span><span class="vc-value">${stats.annual}일</span></div>
    <div class="vc-row"><span class="vc-label">사용</span><span class="vc-value">${stats.used}일</span></div>
    <div class="vc-row total"><span class="vc-label">잔여</span><span class="vc-value remaining">${stats.remaining}일</span></div>
  </div>`;

  return {
    success: true, matched: true, intent: 'vacation_query',
    answer: `<strong>${name}</strong> 님의 휴가 현황입니다.\n\n📋 사용 내역:\n${usedList}`,
    extra: card, meta: {},
    annual: stats.annual, usedDays: stats.used, remaining: stats.remaining, records: stats.records
  };
}

async function vacationAll() {
  const result = await pool.query(`
    SELECT
      v.member_name as name,
      COALESCE(m.annual_leave, 12) as annual,
      COALESCE(SUM(v.days), 0) as used
    FROM chatbot_vacations v
    LEFT JOIN chatbot_members m ON v.member_name = m.name
    WHERE v.cancelled = false
    GROUP BY v.member_name, m.annual_leave
    ORDER BY v.member_name
  `);

  const summary = result.rows.map(r => ({
    name: r.name,
    annual: parseInt(r.annual),
    used: parseInt(r.used),
    remaining: parseInt(r.annual) - parseInt(r.used)
  }));

  const rows = summary.map(s => `  ${s.name}: ${s.used}일 사용 / ${s.remaining}일 남음`).join('\n');

  return {
    success: true, matched: true, intent: 'vacation_all',
    answer: `📊 <strong>전체 휴가 현황</strong>\n\n${rows || '  등록된 휴가가 없습니다.'}`,
    extra: '', meta: {}, summary
  };
}

async function vacationCancel(vacationId) {
  const result = await pool.query(
    `UPDATE chatbot_vacations SET cancelled = true WHERE id = $1 AND cancelled = false RETURNING *`,
    [vacationId]
  );

  if (result.rows.length === 0) {
    return { success: false, error: '해당 휴가 기록을 찾을 수 없습니다.' };
  }

  const v = result.rows[0];
  const stats = await getVacationStats(v.member_name);

  return {
    success: true,
    message: `${v.member_name} 님의 휴가가 취소되었습니다.`,
    cancelled: v,
    remaining: stats.remaining
  };
}

async function vacationListWithIds(name) {
  const stats = await getVacationStats(name);
  const records = await pool.query(
    `SELECT id, start_date::text, end_date::text, days, memo
     FROM chatbot_vacations
     WHERE member_name = $1 AND cancelled = false
     ORDER BY start_date DESC`,
    [name]
  );

  return {
    success: true, name,
    annual: stats.annual, used: stats.used, remaining: stats.remaining,
    records: records.rows
  };
}

async function getVacationStats(name) {
  const memberResult = await pool.query(
    `SELECT annual_leave FROM chatbot_members WHERE name = $1 LIMIT 1`,
    [name]
  );
  const annual = memberResult.rows.length > 0 ? memberResult.rows[0].annual_leave : 12;

  const vacResult = await pool.query(
    `SELECT id, start_date::text, end_date::text, days, memo
     FROM chatbot_vacations
     WHERE member_name = $1 AND cancelled = false
     ORDER BY start_date`,
    [name]
  );

  const totalUsed = vacResult.rows.reduce((sum, r) => sum + r.days, 0);

  return {
    annual,
    used: totalUsed,
    remaining: annual - totalUsed,
    records: vacResult.rows
  };
}

// ═══════════════════════════════════════════════════════════
// Jarvis DB 검색 (인적사항, 과제, 계정, 규정)
// ═══════════════════════════════════════════════════════════

async function handleMemberInfo(entities, message) {
  let name = entities?.name || '';
  if (!name) {
    const m = message.match(/([가-힣]{2,4})\s*(학번|이메일|메일|전화|연락처|번호|정보|연구자|인적)/);
    if (m) name = m[1];
  }
  if (!name) return fail('누구의 정보를 찾으시나요?\n\n예시: "김태영 학번" 또는 "이유림 이메일"');

  const result = await pool.query(
    `SELECT name, student_id, researcher_id, email, phone, role
     FROM chatbot_members WHERE name ILIKE $1 AND active = true`,
    [`%${name}%`]
  );

  if (result.rows.length === 0) {
    return fail(`"${name}" 관련 구성원 정보를 찾을 수 없습니다.`);
  }

  const lines = result.rows.map(r => {
    const parts = [`<strong>이름</strong>: ${r.name}`];
    if (r.student_id) parts.push(`<strong>학번</strong>: ${r.student_id}`);
    if (r.researcher_id) parts.push(`<strong>연구자등록번호</strong>: ${r.researcher_id}`);
    if (r.email) parts.push(`<strong>이메일</strong>: ${r.email}`);
    if (r.phone) parts.push(`<strong>전화</strong>: ${r.phone}`);
    if (r.role) parts.push(`<strong>과정</strong>: ${r.role}`);
    return parts.join('\n');
  }).join('\n\n---\n\n');

  return {
    success: true, matched: true, intent: 'member_info',
    answer: `<strong>👤 인적사항</strong> — "${name}"\n\n${lines}`,
    extra: '<div class="ai-tag">🔍 DB 검색</div>', meta: {}
  };
}

async function handleAccountInfo(entities, message) {
  let keyword = entities?.keyword || entities?.service || '';
  if (!keyword) {
    keyword = message.replace(/계정|비밀번호|비번|로그인|아이디|패스워드|정보|알려줘|뭐야|어떻게/g, '').trim();
  }
  if (!keyword) return fail('어떤 서비스의 계정 정보를 찾으시나요?\n\n예시: "아고다 계정"');

  const result = await pool.query(
    `SELECT service_name, login_id, password, url, memo
     FROM chatbot_accounts
     WHERE service_name ILIKE $1 OR memo ILIKE $1`,
    [`%${keyword}%`]
  );

  if (result.rows.length === 0) {
    return { success: true, matched: false, answer: `"${keyword}" 관련 계정 정보를 찾을 수 없습니다.`, extra: '', meta: {} };
  }

  const lines = result.rows.map(r => {
    const parts = [`<strong>서비스</strong>: ${r.service_name}`];
    if (r.login_id) parts.push(`<strong>ID</strong>: ${r.login_id}`);
    if (r.password) parts.push(`<strong>PW</strong>: ${r.password}`);
    if (r.url) parts.push(`<strong>URL</strong>: ${r.url}`);
    if (r.memo) parts.push(`<strong>메모</strong>: ${r.memo}`);
    return parts.join('\n');
  }).join('\n\n---\n\n');

  return {
    success: true, matched: true, intent: 'account_info',
    answer: `<strong>🔑 계정 정보</strong> — "${keyword}"\n\n${lines}`,
    extra: '<div class="ai-tag">🔍 DB 검색</div>', meta: {}
  };
}

async function handleProjectInfo(entities, message) {
  let keyword = entities?.keyword || entities?.project_name || '';
  if (!keyword) {
    keyword = message.replace(/과제|정보|번호|알려줘|뭐야|현재|진행|중인/g, '').trim();
  }

  if (!keyword || keyword.length < 2) {
    const result = await pool.query(`SELECT project_name, status FROM chatbot_projects ORDER BY project_name`);
    if (result.rows.length === 0) return fail('등록된 과제 정보가 없습니다.');
    const list = result.rows.map(r => `  • ${r.project_name} (${r.status})`).join('\n');
    return { success: true, matched: true, intent: 'project_info', answer: `<strong>📋 등록된 과제 목록</strong>\n\n${list}`, extra: '', meta: {} };
  }

  const result = await pool.query(
    `SELECT * FROM chatbot_projects
     WHERE project_name ILIKE $1 OR project_number ILIKE $1 OR funding_agency ILIKE $1 OR memo ILIKE $1`,
    [`%${keyword}%`]
  );

  if (result.rows.length === 0) {
    return { success: true, matched: false, answer: `"${keyword}" 관련 과제 정보를 찾을 수 없습니다.`, extra: '', meta: {} };
  }

  const lines = result.rows.map(r => {
    const parts = [`<strong>과제명</strong>: ${r.project_name}`];
    if (r.project_number) parts.push(`<strong>과제번호</strong>: ${r.project_number}`);
    if (r.funding_agency) parts.push(`<strong>지원기관</strong>: ${r.funding_agency}`);
    if (r.period) parts.push(`<strong>기간</strong>: ${r.period}`);
    if (r.budget) parts.push(`<strong>연구비</strong>: ${r.budget}`);
    if (r.status) parts.push(`<strong>상태</strong>: ${r.status}`);
    return parts.join('\n');
  }).join('\n\n---\n\n');

  return {
    success: true, matched: true, intent: 'project_info',
    answer: `<strong>📋 과제 정보</strong> — "${keyword}"\n\n${lines}`,
    extra: '<div class="ai-tag">🔍 DB 검색</div>', meta: {}
  };
}

async function handleRegulationInfo(entities, message) {
  let keyword = entities?.keyword || entities?.topic || '';
  if (!keyword) {
    keyword = message.replace(/규정|매뉴얼|지침|알려줘|뭐야|어떻게|관련/g, '').trim();
  }
  if (!keyword || keyword.length < 2) return fail('어떤 규정을 찾으시나요?\n\n예시: "출장비 규정" 또는 "식대 한도"');

  const result = await pool.query(
    `SELECT title, content, category, source
     FROM chatbot_regulations
     WHERE title ILIKE $1 OR content ILIKE $1 OR category ILIKE $1`,
    [`%${keyword}%`]
  );

  if (result.rows.length === 0) {
    return { success: true, matched: false, answer: `"${keyword}" 관련 규정을 찾을 수 없습니다.`, extra: '', meta: {} };
  }

  const lines = result.rows.slice(0, 5).map(r => {
    const parts = [`<strong>${r.title}</strong>`];
    if (r.content) parts.push(r.content);
    if (r.source) parts.push(`<em>출처: ${r.source}</em>`);
    return parts.join('\n');
  }).join('\n\n---\n\n');

  return {
    success: true, matched: true, intent: 'regulation_info',
    answer: `<strong>📖 규정/매뉴얼</strong> — "${keyword}"\n\n${lines}`,
    extra: '<div class="ai-tag">🔍 DB 검색</div>', meta: {}
  };
}

// ═══════════════════════════════════════════════════════════
// FAQ 검색 — Supabase + Gemini
// ═══════════════════════════════════════════════════════════

async function handleFaqSearch(query, history) {
  const faqs = await getCachedFaq();
  if (!faqs || faqs.length === 0) {
    return fail('FAQ 데이터를 로드할 수 없습니다.');
  }

  const relevant = filterRelevantFAQs(faqs, query);
  const geminiAnswer = await callGeminiForFAQ(query, relevant, history);

  if (!geminiAnswer || geminiAnswer.answer === 'NO_MATCH') {
    await pool.query(
      `INSERT INTO chatbot_faq (question, status) VALUES ($1, '답변대기')`,
      [query]
    ).catch(err => console.error('미답변 등록 실패:', err.message));

    return {
      success: true, matched: false,
      answer: '이 질문에 대한 답변이 아직 FAQ에 없습니다.\n\n질문이 DB에 등록되었습니다. 답변이 추가되면 다음에는 바로 찾아드릴 수 있습니다.',
      extra: '<div class="pending-tag">⏳ 답변을 기다리고 있습니다</div>',
      meta: {}
    };
  }

  let sourceInfo = '';
  if (geminiAnswer.sourceIndex !== undefined && relevant[geminiAnswer.sourceIndex]) {
    const src = relevant[geminiAnswer.sourceIndex];
    sourceInfo = src.answered_date ? `📅 답변: ${src.answered_date}${src.answered_by ? ' · ' + src.answered_by : ''}` : '';
  }

  let extra = '<div class="ai-tag">🤖 AI가 FAQ 기반으로 답변을 정리했습니다</div>';
  if (sourceInfo) extra = `<div class="answer-date">${sourceInfo}</div>` + extra;

  return {
    success: true, matched: true, intent: 'faq_search',
    answer: geminiAnswer.answer, extra, meta: {}
  };
}

async function getCachedFaq() {
  const now = Date.now();
  if (faqCache && (now - faqCacheTime) < FAQ_CACHE_TTL) return faqCache;

  try {
    const result = await pool.query(
      `SELECT question, answer, keywords, category, answered_by, answered_date::text
       FROM chatbot_faq WHERE status = '답변완료' ORDER BY id`
    );
    faqCache = result.rows;
    faqCacheTime = now;
    return faqCache;
  } catch (err) {
    console.error('FAQ 로드 실패:', err.message);
    return faqCache || [];
  }
}

function filterRelevantFAQs(faqList, userQuery) {
  const keywords = extractKeywords(userQuery);
  if (keywords.length === 0) return faqList.slice(0, 15);

  const scored = faqList.map(faq => {
    const qLower = faq.question.toLowerCase();
    const aLower = (faq.answer || '').toLowerCase();
    let score = 0;

    for (const kw of keywords) {
      const kwLower = kw.toLowerCase();
      if (qLower.includes(kwLower)) score += 3;
      if (aLower.includes(kwLower)) score += 1;
      if (faq.keywords) {
        for (const tag of faq.keywords) {
          if (tag.toLowerCase().includes(kwLower)) score += 2;
        }
      }
    }
    return { faq, score };
  });

  scored.sort((a, b) => b.score - a.score);
  const filtered = scored.filter(s => s.score > 0).slice(0, 15).map(s => s.faq);
  return filtered.length > 0 ? filtered : faqList.slice(0, 10);
}

function extractKeywords(text) {
  const stopWords = new Set(['은', '는', '이', '가', '을', '를', '에', '에서', '으로', '로', '의', '도', '만',
    '좀', '것', '수', '어떻게', '뭐', '어디', '언제', '왜', '누구', '어떤', '무엇',
    '해', '하', '해줘', '알려줘', '해주세요', '알려주세요', '입니다', '있나요', '있어요']);

  return text.replace(/[?!.,\s]+/g, ' ').trim().split(' ')
    .filter(w => w.length >= 2 && !stopWords.has(w));
}

async function callGeminiForFAQ(userQuery, faqList, history) {
  if (!GEMINI_API_KEY) return null;

  const faqContext = faqList.map((f, i) => `FAQ #${i + 1}\n질문: ${f.question}\n답변: ${f.answer}`).join('\n\n');

  let historyContext = '';
  if (history && history.length > 0) {
    historyContext = '\n\n최근 대화:\n' +
      history.map(h => `사용자: ${h.user_message}\n봇: ${(h.bot_response || '').substring(0, 150)}`).join('\n');
  }

  const prompt = `당신은 BLISS Lab 연구실 FAQ 챗봇입니다.

아래 등록된 FAQ 목록을 참고하여 사용자 질문에 답변하세요.

규칙:
1. 반드시 FAQ에 등록된 내용만 기반으로 답변하세요.
2. 관련 FAQ가 없으면 반드시 "NO_MATCH"만 출력하세요.
3. 답변할 때 FAQ 원문을 자연스럽게 재구성하되, 핵심 정보는 정확히 전달하세요.
4. 답변 마지막에 [출처: FAQ N] 형식으로 참고한 FAQ 번호를 표시하세요.
5. 이전 대화 맥락도 참고하여 자연스럽게 이어지도록 답변하세요.

등록된 FAQ:
${faqContext}
${historyContext}

사용자 질문: ${userQuery}

답변:`;

  try {
    const answer = await geminiCall(prompt, 0.3, 800);
    if (!answer) return null;

    if (answer === 'NO_MATCH' || answer.includes('NO_MATCH')) {
      return { answer: 'NO_MATCH' };
    }

    const srcMatch = answer.match(/\[출처:\s*FAQ\s*(\d+)\]/);
    const sourceIndex = srcMatch ? parseInt(srcMatch[1]) - 1 : undefined;
    const cleanAnswer = answer.replace(/\[출처:\s*FAQ\s*[\d,\s]+\]/g, '').trim();

    return { answer: cleanAnswer, sourceIndex };
  } catch (err) {
    console.error('callGeminiForFAQ error:', err.message);
    return null;
  }
}

// ═══════════════════════════════════════════════════════════
// Gemini API 호출 유틸리티
// ═══════════════════════════════════════════════════════════
async function geminiCall(prompt, temperature = 0.1, maxTokens = 300) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature, maxOutputTokens: maxTokens }
      })
    });

    const result = await response.json();
    if (result.error) {
      console.error('Gemini API error:', result.error);
      await logError('geminiCall', `Gemini API: ${result.error.message || JSON.stringify(result.error)}`, `Model: ${GEMINI_MODEL}`);
      return null;
    }

    return result.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || null;
  } catch (err) {
    console.error('geminiCall fetch error:', err.message);
    await logError('geminiCall', err.message, err.stack);
    return null;
  }
}

// ═══════════════════════════════════════════════════════════
// 유틸리티
// ═══════════════════════════════════════════════════════════
function fail(answer) {
  return { success: true, matched: false, answer, extra: '', meta: {} };
}

// ═══════════════════════════════════════════════════════════
// 서버 시작
// ═══════════════════════════════════════════════════════════
app.listen(PORT, async () => {
  console.log(`\n🔬 BLISS Lab Chatbot v4.1 running on port ${PORT}`);
  console.log(`   http://localhost:${PORT}\n`);

  try {
    const dbCheck = await pool.query('SELECT NOW()');
    console.log('   ✅ Supabase connected:', dbCheck.rows[0].now);
    const faq = await getCachedFaq();
    console.log(`   ✅ FAQ preloaded: ${faq.length} entries`);
  } catch (err) {
    console.error('   ❌ DB connection failed:', err.message);
  }
});
