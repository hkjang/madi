// Rebuild offline-readable manuals and the complete, real-screenshot gallery.
// npm --prefix web ci first; no network access is needed by this generator.
import { readFile, writeFile, readdir, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const docs = path.join(root, "docs");
const require = createRequire(path.join(root, "web/package.json"));
const { Marked } = await import(pathToFileURL(require.resolve("marked")).href);
const origin = "https://hkjang.github.io/madi/";
const version = (await readFile(path.join(root, "VERSION"), "utf8"))
  .trim()
  .replace(/^v/, "");
const escape = (s) =>
  String(s).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const slug = (s) =>
  s
    .toLowerCase()
    .replace(/<[^>]*>/g, "")
    .replace(/[^\p{L}\p{N}\s_-]/gu, "")
    .trim()
    .replace(/\s+/g, "-");
function page(title, description, content, target, depth = "", schema = {}) {
  return `<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#164e43">
<title>${escape(title)} — madi</title><meta name="description" content="${escape(description)}"><link rel="canonical" href="${origin + target}"><link rel="icon" href="${depth}assets/favicon.svg" type="image/svg+xml"><link rel="stylesheet" href="${depth}assets/style.css">
<meta property="og:type" content="website"><meta property="og:locale" content="ko_KR"><meta property="og:site_name" content="madi"><meta property="og:title" content="${escape(title)} — madi"><meta property="og:description" content="${escape(description)}"><meta property="og:url" content="${origin + target}"><meta property="og:image" content="${origin}screenshots/workspace.png"><meta name="twitter:card" content="summary_large_image">
<script type="application/ld+json">${JSON.stringify({ "@context": "https://schema.org", "@type": "TechArticle", headline: title, description, inLanguage: "ko", url: origin + target, isPartOf: { "@type": "WebSite", name: "madi", url: origin }, ...schema }).replace(/</g, "\\u003c")}</script></head>
<body><a class="skip" href="#main">본문으로 바로가기</a><header class="site-header"><div class="container header-inner"><a class="brand" href="${depth}index.html" aria-label="madi 홈"><img src="${depth}assets/logo.svg" alt="madi" width="113" height="40"></a><button class="mobile-toggle" type="button" aria-expanded="false" aria-controls="navigation" aria-label="탐색 메뉴 열기">☰</button><nav class="nav" id="navigation" aria-label="주 탐색"><a href="${depth}index.html#features">기능</a><a href="${depth}screenshots.html">화면 둘러보기</a><a href="${depth}guide.html">시작 가이드</a><a href="${depth}manuals.html">전체 매뉴얼</a><a href="${depth}api.html">API · MCP</a><a href="https://github.com/hkjang/madi">GitHub ↗</a></nav></div></header>
<main id="main" class="container">${content}</main>
<footer class="site-footer"><div class="container"><div class="footer-top"><a class="brand" href="${depth}index.html"><img src="${depth}assets/logo.svg" alt="madi" width="90" height="32"></a><div class="footer-links"><a href="${depth}manuals.html">사용자·관리자 매뉴얼</a><a href="${depth}screenshots.html">실제 화면</a><a href="https://github.com/hkjang/madi">소스 저장소 ↗</a></div></div><p class="footer-bottom">madi v${escape(version)} · 우리 조직의 지식이 연결되는 공간.</p></div></footer>
<dialog class="lightbox" aria-label="서비스 화면 확대"><img alt=""><div class="lightbox-caption"><span data-caption></span><button class="lightbox-close" type="button">닫기 ×</button></div></dialog><script src="${depth}assets/site.js" defer></script></body></html>\n`;
}

const files = (await readdir(docs))
  .filter((name) => name.endsWith(".md") && !name.endsWith("-design.md"))
  .sort();
const manuals = [];
await mkdir(path.join(docs, "manuals"), { recursive: true });
for (const file of files) {
  const markdown = await readFile(path.join(docs, file), "utf8");
  const title = markdown.match(/^#\s+(.+)$/m)?.[1] || file.replace(/\.md$/, "");
  const headings = [],
    seen = new Map();
  const marked = new Marked({ gfm: true });
  marked.use({
    renderer: {
      heading(token) {
        const text = this.parser.parseInline(token.tokens),
          base = slug(token.text),
          count = seen.get(base) || 0;
        seen.set(base, count + 1);
        const id = base + (count ? `-${count}` : "");
        if (token.depth > 1 && token.depth <= 3)
          headings.push({ text: token.text, id });
        return `<h${token.depth} id="${escape(id)}">${text}</h${token.depth}>\n`;
      },
    },
  });
  let body = marked.parse(markdown);
  body = body.replace(
    /href="\.\.\/(deploy|scripts|desktop|extensions)\/([^"]+)"/g,
    'href="https://github.com/hkjang/madi/blob/main/$1/$2"',
  );
  body = body
    .replace(/href="([^"#]+)\.md(#[^"]*)?"/g, (whole, base, hash = "") => {
      if (base.startsWith("http") || base.startsWith("/")) return whole;
      if (!base.includes("/") && files.includes(base + ".md"))
        return `href="${base}.html${hash}"`;
      return `href="https://github.com/hkjang/madi/blob/main/${escape(path.posix.normalize("docs/" + base + ".md"))}${hash}"`;
    })
    .replace(/(src|href)="((?:screenshots|benchmarks)\/[^\"]+)"/g, '$1="../$2"');
  body = body
    .replace(/<table>/g, '<div class="table-wrap"><table>')
    .replace(/<\/table>/g, "</table></div>");
  const target = "manuals/" + file.replace(/\.md$/, ".html");
  const description = `${title}. madi의 실제 설정 방법, 사용자 권한, 기능 흐름과 운영상 주의점을 안내합니다.`;
  const content = `<div class="page-hero"><a class="crumb" href="../manuals.html">madi / 전체 매뉴얼</a><p>${escape(description)}</p><a href="../${escape(file)}" download>Markdown 원문 내려받기</a></div><div class="guide-layout"><aside class="guide-sidebar" aria-label="문서 목차"><strong>이 문서의 내용</strong>${headings.map((h) => `<a href="#${escape(h.id)}">${escape(h.text)}</a>`).join("")}</aside><article class="prose manual-prose">${body}</article></div>`;
  await writeFile(
    path.join(docs, target),
    page(title, description, content, target, "../"),
  );
  manuals.push({ title, target });
}
const manualList = `<div class="page-hero"><a class="crumb" href="index.html">madi / 매뉴얼</a><h1>사용자에서 운영자까지,<br>필요한 안내를 한곳에.</h1><p>문서 작성, 팀 운영, AI·에이전트, 기업 시스템 연결과 폐쇄망 배포를 위한 상세 가이드입니다. 모든 본문은 이 사이트에서 바로 읽을 수 있습니다.</p></div><div class="manual-grid">${manuals.map((m) => `<a class="manual-link" href="${m.target}"><h2>${escape(m.title)}</h2><span>가이드 읽기 →</span></a>`).join("")}</div>`;
await writeFile(
  path.join(docs, "manuals.html"),
  page(
    "사용자·관리자 전체 매뉴얼",
    "madi의 문서·협업·검색·AI·Agent·기업 연동·정보보호·폐쇄망 운영 상세 가이드 모음.",
    manualList,
    "manuals.html",
    "",
    { "@type": "CollectionPage" },
  ),
);

const words = {
  actions: "작업",
  api: "API",
  artifacts: "보관 파일",
  captured: "수집 결과",
  detail: "상세",
  imap: "IMAP",
  private: "비공개",
  registered: "등록 결과",
  s3: "S3",
  schedule: "예약",
  webhooks: "웹훅",
  channel: "채널",
  delivery: "전송 이력",
  deliveries: "전송 이력",
  automations: "자동화",
  job: "작업",
  admin: "관리자",
  workspace: "워크스페이스",
  settings: "설정",
  document: "문서",
  documents: "모든 문서",
  editor: "편집기",
  source: "원문",
  location: "위치",
  foundations: "기본 편집",
  history: "이력",
  diff: "변경 비교",
  graph: "지식 그래프",
  local: "현재 문서 중심",
  ai: "AI",
  citations: "출처",
  citation: "인용",
  verification: "검증",
  draft: "초안",
  review: "검토",
  natural: "자연어",
  search: "검색",
  selected: "선택 문서",
  summary: "요약",
  knowledge: "지식",
  gap: "보완 제안",
  personal: "개인",
  rag: "RAG",
  index: "색인",
  consent: "동의",
  agent: "Agent",
  action: "작업",
  confirm: "확인",
  run: "실행",
  approval: "승인",
  inbox: "수집함",
  block: "블록",
  organizer: "구조 편집",
  canvas: "캔버스",
  drawing: "드로잉",
  command: "명령",
  palette: "팔레트",
  database: "데이터베이스",
  databases: "데이터베이스 목록",
  advanced: "고급 속성",
  board: "보드",
  calendar: "달력",
  gallery: "갤러리",
  list: "목록",
  table: "표",
  timeline: "타임라인",
  desktop: "데스크톱",
  offline: "오프라인",
  devices: "기기",
  discussion: "토론",
  lifecycle: "생명주기",
  policy: "정책",
  watermark: "워터마크",
  export: "내보내기",
  import: "가져오기",
  center: "센터",
  results: "결과",
  result: "결과",
  favorites: "즐겨찾기",
  git: "Git",
  sync: "동기화",
  preview: "미리보기",
  classify: "분류",
  information: "정보",
  protection: "보호",
  keyboard: "단축키",
  health: "건강 상태",
  quality: "품질",
  score: "점수",
  login: "로그인",
  members: "멤버",
  migration: "가져오기",
  folder: "폴더",
  mobile: "모바일",
  branding: "브랜딩",
  menu: "메뉴",
  navigation: "탐색",
  operations: "운영 상태",
  plugins: "플러그인",
  plugin: "플러그인",
  permissions: "권한",
  permission: "권한",
  spaces: "공간",
  space: "공간",
  support: "지원 진단",
  tasks: "할 일",
  task: "할 일",
  teams: "팀",
  telemetry: "텔레메트리",
  templates: "템플릿",
  template: "템플릿",
  universal: "통합",
  vault: "보관함",
  organizations: "조직",
  presentation: "프레젠테이션",
  profile: "개인 설정",
  dark: "다크 테마",
  expanded: "고급 설정",
  public: "공개",
  share: "공유",
  create: "생성",
  password: "비밀번호",
  runbook: "Runbook",
  execution: "실행",
  code: "코드",
  filters: "필터",
  start: "시작",
  properties: "속성",
  html: "HTML",
  kanban: "칸반",
  library: "라이브러리",
  trash: "휴지통",
  web: "웹",
  clipper: "클리퍼",
  features: "기능 플래그",
  audit: "감사",
  backup: "백업",
  dashboard: "대시보드",
  oidc: "OIDC",
  security: "보안",
  storage: "저장소",
  workflow: "승인 절차",
  users: "사용자",
  user: "사용자",
  identity: "기업 인증",
  ldap: "LDAP",
  saml: "SAML",
  scim: "SCIM",
  connector: "커넥터",
  connectors: "커넥터",
  sql: "SQL",
  sources: "소스",
  text2sql: "Text2SQL",
  enterprise: "기업 데이터",
  entity: "엔터티",
  entities: "엔터티",
  notification: "알림",
  notifications: "알림",
  capture: "수집",
  channels: "채널",
  inbound: "수신",
  automation: "자동화",
  jobs: "작업 큐",
  webhook: "웹훅",
  data: "외부 데이터",
  directory: "디렉터리",
  group: "그룹",
  mapping: "역할 매핑",
  plan: "계획",
  query: "조회",
  proposals: "추천 후보",
  topic: "주제",
  keys: "키",
  preferences: "개인 설정",
};
const groups = {
  workspace: "문서·협업·탐색",
  data: "데이터·할 일·기업 지식",
  ai: "검색·AI·Agent",
  admin: "서비스·조직 운영",
  personal: "개인화·공유·기기",
  mobile: "모바일",
};
function category(name) {
  if (/(^|-)mobile($|-)/.test(name)) return "mobile";
  if (
    /^(admin|support|approval-admin|organizations|space|members|teams|workspace-(settings|branding|features))/.test(
      name,
    )
  )
    return "admin";
  if (/(search|^graph-ai|^ai-|^agent-|^rag-|rag-index|personal-ai)/.test(name))
    return "ai";
  if (
    /^(database|data-source|task|runbook|enterprise|entity|entities|sql-|text2sql|connector)/.test(
      name,
    )
  )
    return "data";
  if (
    /^(profile|login|api-keys|public-share|devices|desktop|offline|clipper|web-clipper|keyboard|notification)/.test(
      name,
    )
  )
    return "personal";
  return "workspace";
}
const screenshots = [];
for (const file of (await readdir(path.join(docs, "screenshots"))).sort()) {
  if (!file.endsWith(".png") || /failure|^product-/.test(file)) continue;
  const name = file.slice(0, -4),
    bytes = await readFile(path.join(docs, "screenshots", file));
  if (
    !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  )
    throw new Error("Invalid PNG: " + file);
  screenshots.push({
    file,
    title: name
      .split("-")
      .map((part) => words[part] || part)
      .join(" · "),
    category: category(name),
    width: bytes.readUInt32BE(16),
    height: bytes.readUInt32BE(20),
    sha256: createHash("sha256").update(bytes).digest("hex"),
  });
}
const featured = [
  "workspace.png",
  "documents.png",
  "document.png",
  "editor-source.png",
  "document-summary-list.png",
];
screenshots.sort((a, b) => {
  const rank = (name) =>
    featured.includes(name) ? featured.indexOf(name) : featured.length;
  return rank(a.file) - rank(b.file) || a.file.localeCompare(b.file);
});
let content = `<div class="page-hero"><a class="crumb" href="index.html">madi / 실제 화면</a><h1>사람과 AI가 함께 쓰는 공간,<br>모든 화면을 둘러보세요.</h1><p>실제 서비스에서 데모 계정·문서로 촬영한 ${screenshots.length}개 화면입니다. 문서와 관리자 설정, 연결과 동의 절차, 모바일 화면을 포함합니다. 가상 목업이 아니며 비밀값은 표시하지 않습니다.</p></div><form class="gallery-filters" role="search" aria-label="화면 검색"><label>화면 이름<input id="gallery-query" aria-label="화면 이름" type="search" placeholder="검색, 승인, 키, 문서…"></label><label>분류<select id="gallery-category" aria-label="분류"><option value="">모든 분류</option>${Object.entries(
  groups,
)
  .map(([id, label]) => `<option value="${id}">${label}</option>`)
  .join(
    "",
  )}</select></label><p id="gallery-count" role="status">전체 ${screenshots.length}개 화면</p></form>`;
for (const [id, title] of Object.entries(groups)) {
  content += `<section class="gallery-group" id="${id}" data-gallery-group><h2>${title}</h2><div class="screenshot-grid">`;
  content += screenshots
    .filter((s) => s.category === id)
    .map(
      (s) =>
        `<figure class="screen-card${s.width < 700 ? " mobile-screen" : ""}" data-gallery-card data-category="${id}" data-title="${escape(s.title)}"><button class="screen-button" type="button" data-screenshot aria-label="${escape(s.title)} 화면 확대"><img src="screenshots/${s.file}" alt="madi ${escape(s.title)} 실제 화면" loading="lazy" decoding="async" width="${s.width}" height="${s.height}"><span class="zoom-label">확대해서 보기 ↗</span></button><figcaption><h3>${escape(s.title)}</h3><p>실제 서비스 화면 · ${s.width} × ${s.height}</p></figcaption></figure>`,
    )
    .join("");
  content += "</div></section>";
}
await writeFile(
  path.join(docs, "screenshots.html"),
  page(
    "사용자·관리자·모바일 전체 화면",
    "madi의 문서·협업·검색·그래프·AI·기업 데이터·관리자 설정·모바일 실제 화면을 검색하고 확대해 보세요.",
    content,
    "screenshots.html",
    "",
    { "@type": "CollectionPage" },
  ),
);
await writeFile(
  path.join(docs, "screenshots/manifest.json"),
  JSON.stringify(
    {
      version,
      description:
        "실제 브라우저 성공 화면 목록. 실패 진단 화면은 제외합니다. 이미지 해시는 마지막 재생성 시점 기준입니다.",
      screenshots,
    },
    null,
    2,
  ) + "\n",
);
const urls = [
  "",
  "guide.html",
  "api.html",
  "screenshots.html",
  "manuals.html",
  ...manuals.map((m) => m.target),
];
await writeFile(
  path.join(docs, "sitemap.xml"),
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((u) => `  <url><loc>${origin}${u}</loc></url>`).join("\n")}\n</urlset>\n`,
);
console.log(
  JSON.stringify({
    manuals: manuals.length,
    screenshots: screenshots.length,
    sitemap: urls.length,
  }),
);
