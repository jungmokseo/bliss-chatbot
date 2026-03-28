// ═══════════════════════════════════════════════════════════
// BLISS Lab Chatbot — Seed Data (기존 Notion DB → Supabase)
// ═══════════════════════════════════════════════════════════
// Run: node db/seed.js
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

async function seed() {
  const client = await pool.connect();

  try {
    console.log('🌱 시드 데이터 삽입 시작...\n');

    // ─── 1. 구성원 ────────────────────────────
    console.log('👥 구성원 데이터...');
    const members = [
      { name: '이연택', student_id: '2018314113', researcher_id: '11836103', email: 'ytlee94@yonsei.ac.kr', role: '박사과정' },
      { name: '박기준', student_id: '2018324041', researcher_id: '11868917', email: 'kijunpark31@yonsei.ac.kr', role: '박사과정' },
      { name: '박재규', student_id: '2020314107', researcher_id: '12470594', email: 'jaegyu.park@yonsei.ac.kr', role: '박사과정' },
      { name: '김지현', student_id: '2021314076', researcher_id: '11781972', email: 'jihyunkim08@yonsei.ac.kr', role: '박사과정' },
      { name: '김연주', student_id: '2021314134', researcher_id: '11633590', email: 'yeonju.kim@yonsei.ac.kr', role: '박사과정' },
      { name: '황수영', student_id: '2021314092', researcher_id: '11883994', email: 'sooyoung.h@yonsei.ac.kr', role: '박사과정' },
      { name: '강민경', student_id: '2021324063', researcher_id: '12465545', email: 'mkkang@yonsei.ac.kr', role: '석사과정' },
      { name: '김태영', student_id: '2021323092', researcher_id: '12409017', email: 'gkdkak92@yonsei.ac.kr', role: '석사과정' },
      { name: '조예진', student_id: '2021324059', researcher_id: '12556618', email: 'yejin.jo12@yonsei.ac.kr', role: '석사과정' },
      { name: '이유림', student_id: '2022314080', researcher_id: '12771906', email: 'l22yurim@yonsei.ac.kr', role: '박사과정' },
      { name: '김수아', student_id: '2022314090', researcher_id: '12807760', email: 'sooa.kim38@yonsei.ac.kr', role: '박사과정' },
      { name: '오진석', student_id: '2022311316', researcher_id: '12523177', email: 'jinseok.oh13@gmail.com', role: '석사과정' },
      { name: '이주희', student_id: '2022321273', researcher_id: '12692460', email: 'dlwngml0400@naver.com', role: '석사과정' },
      { name: '손가영', student_id: '2024314120', researcher_id: '13076925', email: 'sonky0803@yonsei.ac.kr', role: '석박통합' },
      { name: '김상원', student_id: '2023311334', researcher_id: '12808381', email: 'sangwon277@yonsei.ac.kr', role: '석사과정' },
      { name: '김상인', student_id: '2022321257', researcher_id: '12890611', email: 'tkddls0926@yonsei.ac.kr', role: '석사과정' },
      { name: '박상우', student_id: '2023324065', researcher_id: '12968672', email: 'oowgnas10@yonsei.ac.kr', role: '석사과정' },
      { name: '육근영', student_id: '2024314090', researcher_id: '12941893', email: 'kyyook1118@yonsei.ac.kr', role: '석박통합' },
      { name: '김장호', student_id: '2024311484', researcher_id: '13192440', email: 'jangho.kim@yonsei.ac.kr', role: '석사과정' },
      { name: '박시연', student_id: '2023324044', researcher_id: '13134708', email: 'pksy51630@yonsei.ac.kr', role: '석사과정' },
      { name: '함혜인', student_id: '2025314093', researcher_id: '13275018', email: 'hhi0706@yonsei.ac.kr', role: '석박통합' },
      { name: '김찬수', student_id: '2025324061', researcher_id: '13081012', email: 'nce9080@yonsei.ac.kr', role: '석사과정' },
      { name: '정윤민', student_id: '2025324042', researcher_id: '13406464', email: 'yunminj@yonsei.ac.kr', role: '석사과정' },
      { name: 'Xia BeiBei', student_id: '2025323066', researcher_id: '13419335', email: '', role: '석사과정' },
      // 인턴
      { name: '박지민', student_id: '', researcher_id: '', email: '', role: '인턴', annual_leave: 12 },
      { name: '홍승완', student_id: '', researcher_id: '', email: '', role: '인턴', annual_leave: 12 },
      { name: '김미도', student_id: '', researcher_id: '', email: '', role: '인턴', annual_leave: 12 },
      { name: '장한빛', student_id: '', researcher_id: '', email: '', role: '인턴', annual_leave: 12 },
    ];

    // UPSERT: name 기반
    for (const m of members) {
      await client.query(`
        INSERT INTO chatbot_members (name, student_id, researcher_id, email, role, annual_leave)
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT DO NOTHING
      `, [m.name, m.student_id || null, m.researcher_id || null, m.email || null, m.role, m.annual_leave || 12]);
    }
    console.log(`   ✅ ${members.length}명 삽입 완료`);

    // ─── 2. 기존 휴가 기록 ────────────────────
    console.log('🏖️ 기존 휴가 기록...');
    const vacations = [
      { name: '이유림', start: '2026-01-19', end: '2026-01-19', days: 1 },
      { name: '이유림', start: '2026-01-20', end: '2026-01-20', days: 1 },
      { name: '박시연', start: '2026-01-29', end: '2026-01-30', days: 2 },
      { name: '육근영', start: '2026-02-13', end: '2026-02-13', days: 1 },
      { name: '육근영', start: '2026-02-19', end: '2026-02-20', days: 2 },
      { name: '함혜인', start: '2026-01-30', end: '2026-01-30', days: 1 },
      { name: '함혜인', start: '2026-02-26', end: '2026-02-27', days: 2 },
      { name: '강민경', start: '2026-01-05', end: '2026-01-05', days: 1 },
      { name: '정윤민', start: '2026-01-15', end: '2026-01-15', days: 1 },
      { name: '정윤민', start: '2026-01-16', end: '2026-01-16', days: 1 },
      { name: '손가영', start: '2026-01-19', end: '2026-01-19', days: 1 },
    ];

    for (const v of vacations) {
      await client.query(`
        INSERT INTO chatbot_vacations (member_name, start_date, end_date, days)
        SELECT $1, $2, $3, $4
        WHERE NOT EXISTS (
          SELECT 1 FROM chatbot_vacations
          WHERE member_name = $1 AND start_date = $2 AND end_date = $3 AND cancelled = false
        )
      `, [v.name, v.start, v.end, v.days]);
    }
    console.log(`   ✅ ${vacations.length}건 삽입 완료`);

    // ─── 3. FAQ ───────────────────────────────
    console.log('📋 FAQ 데이터...');
    const faqs = [
      { q: '세미나 일정이 어떻게 돼?', a: '교수님 연구년 기간 중에는 매주 금요일 오전 11시, Zoom으로 진행됩니다. 발표 순서는 Notion 세미나 캘린더를 확인해주세요. 발표자는 최소 이틀 전까지 자료를 공유해주세요.', kw: '{세미나,일정,발표,미팅,주간회의}', cat: '연구실생활', by: '서정목 교수', dt: '2026-03-03' },
      { q: '법인카드 사용 방법', a: '연구비 지출은 연구개발비카드(법인카드)를 사용하는 것이 원칙입니다. 카드 사용이 불가능한 경우에만 계좌이체 또는 현금 사용이 가능하며, 영수증(세금계산서)이 필요합니다. 개인카드 사용은 원칙적으로 불인정됩니다.', kw: '{법인카드,카드,결제,영수증,비용,연구비카드}', cat: '행정/서류', by: '연구비관리 매뉴얼', dt: '2026-03-02' },
      { q: '장비 예약은 어떻게 해?', a: 'Google Calendar의 "연구실 장비 예약" 캘린더에서 예약합니다. SEM, XRD는 최소 하루 전, AFM은 3일 전까지 예약해주세요. 사용 후 반드시 장비 로그에 기록해주세요.', kw: '{장비,예약,기기,측정,SEM,XRD,AFM}', cat: '장비/시설', by: '연구실', dt: '2026-02-18' },
      { q: '출장 서류 뭐 필요해?', a: '출장 전: 출장신청서(RMS 연구비시스템), 지도교수 결재. 출장 후: 출장보고서, 교통비/숙박비 영수증, 참가확인서. 해외 학회는 최소 한 달 전에 신청. 여비 = 운임+일비+숙박비+식비이며, 법인카드 결제 원칙입니다.', kw: '{출장,서류,학회,여비,정산,해외}', cat: '행정/서류', by: '연구실', dt: '2026-01-15' },
      { q: '논문 투고 절차', a: '1단계: 교수님 1차 리뷰 → 2단계: 연구실 내부 발표 → 3단계: 최종 수정 → 4단계: 교수님 최종 확인 후 투고. Cover letter는 기존 템플릿을 사용하세요 (Notion "논문 투고 가이드" 참고).', kw: '{논문,투고,저널,리뷰,submit,paper,제출}', cat: '연구', by: '서정목 교수', dt: '2026-02-10' },
      { q: '택배 수령은 어디서?', a: '연구동 1층 경비실에서 수령합니다. 연구실 이름으로 온 택배는 경비실에서 연락이 오니, 당일 중으로 수령해주세요. 시약류는 반드시 MSDS 확인 후 보관하세요.', kw: '{택배,배송,수령,배달,물품}', cat: '연구실생활', by: '연구실', dt: '2026-02-28' },
      { q: '클린룸 사용 규칙', a: '무진복 착용 필수, 음식물 반입 금지. 사용 전 교육 이수 필수 (신입생은 선배에게 문의). 예약은 연구실 공용 캘린더에서 하고, 사용 후 정리 상태를 사진으로 남겨주세요.', kw: '{클린룸,cleanroom,무진복,반도체,공정}', cat: '장비/시설', by: '연구실', dt: '2026-02-12' },
      { q: '신입생 온보딩 뭐 해야 돼?', a: 'Notion "신입생 가이드" 페이지를 참고해주세요. 핵심: ①출입카드 신청 ②안전교육 이수 ③Notion/잔디 가입 ④연구실 좌석 배정 ⑤장비 교육 신청. 방장(이유림)에게 문의하면 안내해드립니다.', kw: '{신입생,온보딩,입학,새로,처음,시작,세팅}', cat: '연구실생활', by: '연구실', dt: '2026-03-01' },
      { q: '식대 처리는 어떻게?', a: '회의비 식대: 1인당 5만원 이내, 법인카드 결제, 사전 내부결재(참석자 명단) 필요, 평일 근무시간 내 영수증만 인정. 야근/주말 식대: 연구인력지원비로 1인당 3만원 이내, 평일 18~23시 및 주말/공휴일만 가능.', kw: '{식대,밥,점심,저녁,식비,회식,회의비,처리}', cat: '행정/서류', by: '연구비관리 매뉴얼', dt: '2026-03-02' },
      { q: '학생인건비 기준금액이 얼마야?', a: '학위과정별 월 기준금액: 학사과정 130만원, 석사과정 220만원, 박사과정 300만원입니다. 총인건비 계상률은 100% 이내이며, 학생연구자 인건비 지급은 RMS 연구비관리시스템에서 처리합니다.', kw: '{인건비,기준,금액,월급,급여,학생인건비,석사,박사,학사}', cat: '행정/서류', by: '연구비관리 매뉴얼', dt: '2026-03-02' },
      { q: '인건비 지급일이 언제야?', a: '근로소득(학생인건비 포함)은 매월 15일, 기타소득은 매월 25일에 지급됩니다. 해당일이 공휴일인 경우 전 영업일에 지급합니다.', kw: '{인건비,지급일,월급날,급여일,지급}', cat: '행정/서류', by: '연구비관리 매뉴얼', dt: '2026-03-02' },
      { q: '고가 장비 구매할 때 뭐 필요해?', a: '3,000만원 이상(부가세 포함) 연구시설·장비 구매 시 사전심의가 필요합니다. 구매 후에는 ZEUS(국가연구시설장비진흥센터)에 반드시 등록해야 합니다. 구매 전 연구지원팀에 문의하세요.', kw: '{장비,구매,고가,사전심의,3000만,ZEUS}', cat: '장비/시설', by: '연구비관리 매뉴얼', dt: '2026-03-02' },
      { q: '연구비로 구매 못하는 물품이 뭐야?', a: '연구실운영비로 구매 불가 품목: TV, 라디오, 관상용 화분, 카페트, 커피, 차, 음료, 다과류 등입니다. 사무용기기, 소모품, 환경유지비 등은 가능합니다.', kw: '{불인정,구매불가,못하는,금지,불가}', cat: '행정/서류', by: '연구비관리 매뉴얼', dt: '2026-03-02' },
      { q: '논문 게재료는 연구비로 쓸 수 있어?', a: '네, 논문게재료는 연구개발비로 사용 가능합니다. 연구개발비 지원기관 표기 여부와 무관하게 사용할 수 있습니다. 지식재산권 출원·등록비도 마찬가지입니다.', kw: '{게재료,논문비,publication,fee,게재}', cat: '연구', by: '연구비관리 매뉴얼', dt: '2026-03-02' },
      { q: '근무시간이 어떻게 돼?', a: '월요일~금요일, 오전 10시부터입니다. 퇴근 시간은 별도 규정 없으나, 성실한 연구 활동이 기대됩니다.', kw: '{근무,출근,시간,몇시,퇴근}', cat: '연구실생활', by: 'BLISS 인턴 안내', dt: '2026-03-02' },
      { q: '휴가는 며칠이야?', a: '연간 총 12일입니다. 여름방학 4일 + 겨울방학 4일 + 학기 중 4일로 구성됩니다. 사용 시 사전에 교수님께 보고해주세요.', kw: '{휴가,연차,며칠,방학,쉬는날}', cat: '연구실생활', by: 'BLISS 인턴 안내', dt: '2026-03-02' },
      { q: '주간보고는 언제 어떻게 해?', a: '매주 일요일 밤까지 이메일로 제출합니다. 제목에 [Weekly Report]를 포함해주세요. 내용은 이번 주 진행상황, 다음 주 계획, 이슈사항을 포함합니다.', kw: '{주간보고,보고,위클리,weekly,report}', cat: '연구실생활', by: 'BLISS 인턴 안내', dt: '2026-03-02' },
      { q: '공동기기원은 어떻게 이용해?', a: '연세대 공동기기원 웹사이트(ycrf.yonsei.ac.kr)에서 장비 예약 및 교육 신청이 가능합니다. 처음 이용 시 안전교육 이수 및 장비별 사용교육이 필요합니다.', kw: '{공동기기원,ycrf,공동기기,분석장비}', cat: '장비/시설', by: 'BLISS 인턴 안내', dt: '2026-03-02' },
      { q: '연구실 연락처가 뭐야?', a: '연구실 대표 이메일: bliss.yonsei@gmail.com, 교수님 이메일: jungmok.seo@yonsei.ac.kr, 방장(이유림)에게 연구실 생활 관련 문의 가능합니다.', kw: '{연락처,이메일,메일,전화,방장,문의}', cat: '연구실생활', by: 'BLISS 인턴 안내', dt: '2026-03-02' },
      { q: '학생인건비 소급 지급이 가능해?', a: '다음의 경우 소급 지급이 허용됩니다: ①과제 협약 지연, ②연구개발비 입금 지연, ③외국인등록증 발급 지연. 해당 사유를 증빙하여 신청해야 합니다.', kw: '{소급,인건비,지연,늦게}', cat: '행정/서류', by: '연구비관리 매뉴얼', dt: '2026-03-02' },
      { q: '소프트웨어 구매 시 주의사항은?', a: '소프트웨어활용비로 구매 가능하며, 과제 종료 2개월 전까지 사용계약(라이선스)을 체결해야 합니다. 클라우드 컴퓨팅 이용료도 별도 항목으로 사용 가능합니다.', kw: '{소프트웨어,라이선스,SW,프로그램,클라우드}', cat: '행정/서류', by: '연구비관리 매뉴얼', dt: '2026-03-02' },
    ];

    for (const f of faqs) {
      await client.query(`
        INSERT INTO chatbot_faq (question, answer, keywords, category, answered_by, answered_date, status)
        SELECT $1, $2, $3::text[], $4, $5, $6, '답변완료'
        WHERE NOT EXISTS (
          SELECT 1 FROM chatbot_faq WHERE question = $1
        )
      `, [f.q, f.a, f.kw, f.cat, f.by, f.dt]);
    }
    console.log(`   ✅ ${faqs.length}건 삽입 완료`);

    // ─── 요약 ─────────────────────────────────
    console.log('\n📊 데이터 요약:');
    const counts = await Promise.all([
      client.query('SELECT count(*) FROM chatbot_members'),
      client.query('SELECT count(*) FROM chatbot_vacations WHERE cancelled = false'),
      client.query('SELECT count(*) FROM chatbot_faq WHERE status = \'답변완료\''),
    ]);
    console.log(`   구성원: ${counts[0].rows[0].count}명`);
    console.log(`   휴가: ${counts[1].rows[0].count}건`);
    console.log(`   FAQ: ${counts[2].rows[0].count}건`);
    console.log('\n🎉 시드 데이터 삽입 완료!');

  } catch (err) {
    console.error('❌ 시드 실패:', err.message);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

seed().catch(() => process.exit(1));
