const searchInput = document.querySelector('#post-search');
const statusSelect = document.querySelector('#post-status');
const resultCount = document.querySelector('#post-result-count');
const emptyState = document.querySelector('#post-filter-empty');
const rows = Array.from(document.querySelectorAll('[data-post-row]'));

const filterRows = () => {
  const query = searchInput instanceof HTMLInputElement
    ? searchInput.value.trim().toLocaleLowerCase()
    : '';
  const status = statusSelect instanceof HTMLSelectElement ? statusSelect.value : 'all';
  let visible = 0;

  rows.forEach((row) => {
    const rowStatus = row.getAttribute('data-status') ?? '';
    const searchableText = row.getAttribute('data-search')?.toLocaleLowerCase() ?? '';
    const matchesQuery = !query || searchableText.includes(query);
    const matchesStatus = status === 'all' || rowStatus === status;
    const isVisible = matchesQuery && matchesStatus;
    row.toggleAttribute('hidden', !isVisible);
    if (isVisible) visible += 1;
  });

  emptyState?.toggleAttribute('hidden', visible > 0);
  if (resultCount) resultCount.textContent = `${visible}개 글 표시`;
};

searchInput?.addEventListener('input', filterRows);
statusSelect?.addEventListener('change', filterRows);

/* ── 관리 기능 (로컬 관리 서버 npm run admin 연동) ───────────── */

const ADMIN_API = 'http://127.0.0.1:4322';
const adminOnline = { value: false };
let modalPreviousFocus = null;

const setStatusUi = () => {
  const el = document.querySelector('#admin-server-status');
  if (!el) return;
  const notice = document.querySelector('.dashboard-notice');
  const hint = document.querySelector('#admin-server-hint');
  notice?.setAttribute('data-state', adminOnline.value ? 'online' : 'offline');
  el.textContent = adminOnline.value
    ? '관리 서버 연결됨 — 편집·삭제·상태 변경을 사용할 수 있습니다.'
    : '관리 서버 미연결 — 아래 기능을 쓰려면 npm run admin 을 실행하세요.';
  if (hint) {
    hint.textContent = adminOnline.value
      ? '관리 서버가 준비되었습니다. 글 편집·삭제·상태 변경·새 글 작성을 사용할 수 있습니다.'
      : '편집·삭제·상태 변경·새 글 작성은 npm run admin 실행 후 사용할 수 있습니다.';
  }
  document
    .querySelectorAll('.row-actions button, #new-post, #run-check, #kw-discover, #kw-analyze, #kw-briefs')
    .forEach((btn) => btn.toggleAttribute('disabled', !adminOnline.value));
};

const ping = async () => {
  try {
    const res = await fetch(`${ADMIN_API}/api/ping`);
    adminOnline.value = Boolean((await res.json()).ok);
  } catch {
    adminOnline.value = false;
  }
  setStatusUi();
  if (adminOnline.value) void loadBriefs();
};
ping();
setInterval(ping, 10_000);

const openModal = (id) => {
  const modal = document.querySelector(id);
  if (!modal) return;
  modalPreviousFocus = document.activeElement;
  modal.removeAttribute('hidden');
  modal.setAttribute('aria-hidden', 'false');
  requestAnimationFrame(() => {
    const firstControl = Array.from(modal.querySelectorAll('input, textarea, select, button'))
      .find((element) => !element.hasAttribute('disabled') && !element.closest('[hidden]'));
    (firstControl ?? modal.querySelector('.admin-modal-panel'))?.focus();
  });
};
const closeModal = (el) => {
  if (!el) return;
  el.setAttribute('hidden', '');
  el.setAttribute('aria-hidden', 'true');
  if (modalPreviousFocus instanceof HTMLElement) modalPreviousFocus.focus();
  modalPreviousFocus = null;
};
const showError = (el, message, details) => {
  if (!el) return;
  el.textContent = details?.length ? `${message}\n${details.join('\n')}` : message;
  el.removeAttribute('hidden');
};

/* 글 변경 후 개발 서버가 재시작하며 콘텐츠를 재동기화한다 — 복귀를 기다렸다가 한 번만 새로고침 */
const reloadAfterSync = async () => {
  for (let i = 0; i < 25; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    try { const res = await fetch('/'); if (res.ok) { window.location.reload(); return; } } catch { /* 재시작 중 */ }
  }
  window.location.reload(); // 재시작 확인이 25초를 넘겨도 결국 새로고침 시도
};

const rowOf = (btn) => btn.closest('.row-actions')?.getAttribute('data-file') ?? '';

/* 편집 모달 */
const editModal = document.querySelector('#edit-modal');
const editTitle = document.querySelector('#edit-modal-title');
const editNameField = document.querySelector('#edit-name-field');
const editFile = document.querySelector('#edit-file');
const editContent = document.querySelector('#edit-content');
const editError = document.querySelector('#edit-error');
let editingFile = null;

const openEdit = async (file) => {
  editingFile = file;
  editError?.setAttribute('hidden', '');
  if (file) {
    if (editTitle) editTitle.textContent = `글 편집 — ${file}`;
    editNameField?.setAttribute('hidden', '');
    try {
      const res = await fetch(`${ADMIN_API}/api/post?file=${encodeURIComponent(file)}`);
      const data = await res.json();
      if (!res.ok) { showError(editError, data.error); return openModal('#edit-modal'); }
      if (editContent) editContent.value = data.content;
    } catch { return; }
  } else {
    if (editTitle) editTitle.textContent = '새 글 작성';
    editNameField?.removeAttribute('hidden');
    if (editFile) editFile.value = '';
    const today = new Date().toISOString().slice(0, 10);
    if (editContent) {
      editContent.value = [
        '---',
        'title: ""',
        'description: ""',
        `pubDate: ${today}`,
        'status: draft',
        'topic: category-name',
        'angle: ""',
        'author: TBD',
        'sourceIds: []',
        'manualReview: none',
        'manualReviewReasons: []',
        'toolVersions: {}',
        'aiAssisted: true',
        '---',
        '',
        '## 핵심 요약',
        '',
        '## 본문',
        '',
        '## 안 될 때',
        '',
        '## FAQ',
        '',
      ].join('\n');
    }
  }
  openModal('#edit-modal');
};

const saveEdit = async () => {
  if (!editingFile && editFile instanceof HTMLInputElement) {
    const name = editFile.value.trim();
    editingFile = /^[^/\\]+\.md$/.test(name) ? name : null;
    if (!editingFile) return showError(editError, '파일명은 "이름.md" 형태로 입력하세요.');
  }
  try {
    const res = await fetch(`${ADMIN_API}/api/posts`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ file: editingFile, content: editContent?.value ?? '' }),
    });
    const data = await res.json();
    if (!res.ok) return showError(editError, data.error, data.details);
    closeModal(editModal);
    reloadAfterSync();
  } catch (err) {
    showError(editError, `저장 실패: ${err instanceof Error ? err.message : '알 수 없는 오류'}`);
  }
};

/* 상태 모달 */
const statusModal = document.querySelector('#status-modal');
const statusTarget = document.querySelector('#status-modal-target');
const statusSelectEl = document.querySelector('#status-select');
const statusPublishField = document.querySelector('#status-publish-field');
const statusPublish = document.querySelector('#status-publish');
const statusTested = document.querySelector('#status-tested');
const statusAuthor = document.querySelector('#status-author');
const statusError = document.querySelector('#status-error');
let statusFile = null;

const openStatus = async (file) => {
  statusFile = file;
  statusError?.setAttribute('hidden', '');
  if (statusTarget) statusTarget.textContent = file;
  try {
    const res = await fetch(`${ADMIN_API}/api/post?file=${encodeURIComponent(file)}`);
    const data = await res.json();
    const get = (key) => data.content?.match(new RegExp(`^${key}:\\s*"?([^"\\n]+)"?$`, 'm'))?.[1]?.trim();
    if (data.content) {
      const cur = get('status') ?? 'draft';
      if (statusSelectEl instanceof HTMLSelectElement) statusSelectEl.value = cur;
      if (statusPublish instanceof HTMLInputElement) statusPublish.value = (get('publishAt') ?? '').slice(0, 10);
      if (statusTested instanceof HTMLInputElement) statusTested.value = (get('testedAt') ?? '').slice(0, 10);
      if (statusAuthor instanceof HTMLInputElement) statusAuthor.value = get('author') ?? '';
      syncStatusFields();
    }
  } catch { /* 서버 미연결 시 기본값으로 열기 */ }
  openModal('#status-modal');
};

const syncStatusFields = () => {
  const status = statusSelectEl instanceof HTMLSelectElement ? statusSelectEl.value : 'draft';
  statusPublishField?.toggleAttribute('hidden', status !== 'scheduled');
  statusTestedField().toggleAttribute('hidden', status === 'draft');
  statusAuthorField().toggleAttribute('hidden', status === 'draft');
};
const statusTestedField = () => document.querySelector('#status-tested-field') ?? document.createElement('div');
const statusAuthorField = () => document.querySelector('#status-author-field') ?? document.createElement('div');

const applyStatus = async () => {
  try {
    const res = await fetch(`${ADMIN_API}/api/status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        file: statusFile,
        status: statusSelectEl instanceof HTMLSelectElement ? statusSelectEl.value : 'draft',
        publishAt: statusPublish instanceof HTMLInputElement ? statusPublish.value : undefined,
        testedAt: statusTested instanceof HTMLInputElement ? statusTested.value : undefined,
        author: statusAuthor instanceof HTMLInputElement ? statusAuthor.value.trim() : undefined,
      }),
    });
    const data = await res.json();
    if (!res.ok) return showError(statusError, data.error, data.details);
    closeModal(statusModal);
    reloadAfterSync();
  } catch (err) {
    showError(statusError, `적용 실패: ${err instanceof Error ? err.message : '알 수 없는 오류'}`);
  }
};

/* 삭제 */
const deletePost = async (file) => {
  if (!window.confirm(`"${file}" 을 삭제할까요? (.trash/ 로 이동 — 복구 가능)`)) return;
  try {
    const res = await fetch(`${ADMIN_API}/api/post?file=${encodeURIComponent(file)}`, { method: 'DELETE' });
    if (!res.ok) { const d = await res.json(); window.alert(d.error); return; }
    reloadAfterSync();
  } catch (err) {
    window.alert(`삭제 실패: ${err instanceof Error ? err.message : '알 수 없는 오류'}`);
  }
};

/* 키워드 → 초안 파이프라인 */
const kwStatus = (msg) => {
  const el = document.querySelector('#kw-pipeline-status');
  if (el) el.textContent = msg;
};

const kwButtons = ['#kw-discover', '#kw-analyze', '#kw-briefs'];
const setKwBusy = (busy) => {
  kwButtons.forEach((sel) => {
    const btn = document.querySelector(sel);
    if (btn) btn.toggleAttribute('disabled', busy || !adminOnline.value);
  });
};

const runKwAction = async (endpoint, label) => {
  setKwBusy(true);
  kwStatus(`${label} 실행 중… (수 분 걸릴 수 있습니다)`);
  try {
    const res = await fetch(`${ADMIN_API}${endpoint}`, { method: 'POST' });
    const data = await res.json();
    kwStatus(`${label} ${res.ok ? '완료' : '실패'}\n${data.output ?? data.error ?? ''}`);
    if (endpoint === '/api/keywords/briefs' && res.ok) void loadBriefs();
  } catch (err) {
    kwStatus(`${label} 실패: ${err instanceof Error ? err.message : '알 수 없는 오류'}`);
  } finally {
    setKwBusy(false);
  }
};

const loadBriefs = async () => {
  const list = document.querySelector('#kw-brief-list');
  if (!list) return;
  try {
    const res = await fetch(`${ADMIN_API}/api/briefs`);
    const data = await res.json();
    const briefs = data.briefs ?? [];
    list.innerHTML = '';
    if (!briefs.length) { list.setAttribute('hidden', ''); return; }
    list.removeAttribute('hidden');
    for (const b of briefs) {
      const item = document.createElement('div');
      item.className = 'keyword-brief-item';
      const info = document.createElement('div');
      const title = document.createElement('strong');
      title.textContent = `${b.headKeyword ?? b.file}`;
      const meta = document.createElement('small');
      meta.textContent = `${b.category ?? ''} · ${b.intent ?? ''}`;
      info.append(title, meta);
      const btn = document.createElement('button');
      btn.className = 'row-btn';
      btn.type = 'button';
      btn.textContent = '초안 생성';
      btn.addEventListener('click', () => runDraft(b));
      item.append(info, btn);
      list.append(item);
    }
  } catch { /* 서버 미연결 시 무시 */ }
};

const runDraft = async (brief) => {
  const angle = window.prompt(
    `「${brief.headKeyword}」 초안을 생성합니다.\n\n이 글의 각도(angle)를 입력하세요 — 독자에게 줄 하나의 판단 기준:\n(예: "상품 비교보다 일정표 읽는 법을 알려준다")`,
  );
  if (angle === null) return;
  if (angle.trim() === '') { window.alert('각도를 입력해야 초안을 생성할 수 있습니다.'); return; }
  setKwBusy(true);
  kwStatus(`「${brief.headKeyword}」 초안 생성 중… (작성+윤문+심사+이미지, 수 분 소요)`);
  try {
    const res = await fetch(`${ADMIN_API}/api/draft`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        brief: brief.file,
        angle: angle.trim(),
        format: 'how-to',
        briefSha256: brief.sha256,
        reviewer: 'admin-dashboard',
        reason: '관리 대시보드에서 승인',
      }),
    });
    const data = await res.json();
    kwStatus(`초안 생성 ${res.ok ? '완료 — 페이지를 새로고침하면 글 목록에 표시됩니다' : '실패'}\n${data.output ?? data.error ?? ''}`);
    if (res.ok) reloadAfterSync();
  } catch (err) {
    kwStatus(`초안 생성 실패: ${err instanceof Error ? err.message : '알 수 없는 오류'}`);
  } finally {
    setKwBusy(false);
  }
};

/* 콘텐츠 검사 */
const runCheck = async () => {
  const result = document.querySelector('#check-result');
  try {
    const res = await fetch(`${ADMIN_API}/api/check`, { method: 'POST' });
    const data = await res.json();
    if (result) {
      result.textContent = data.output || '결과 없음';
      result.removeAttribute('hidden');
    }
  } catch { /* noop */ }
};

/* 이벤트 위임 */
document.addEventListener('click', (event) => {
  const target = event.target instanceof Element ? event.target : null;
  if (!target) return;

  if (target.classList.contains('admin-modal')) {
    closeModal(target);
    return;
  }

  const actionBtn = target.closest('[data-action]');
  if (actionBtn instanceof HTMLElement && adminOnline.value) {
    const file = rowOf(actionBtn);
    const action = actionBtn.getAttribute('data-action');
    if (!file) return;
    if (action === 'edit') openEdit(file);
    if (action === 'status') openStatus(file);
    if (action === 'delete') deletePost(file);
    return;
  }
  if (target.closest('#new-post')) openEdit(null);
  if (target.closest('#run-check')) runCheck();
  if (target.closest('#kw-discover')) runKwAction('/api/keywords/discover', '키워드 발굴');
  if (target.closest('#kw-analyze')) runKwAction('/api/keywords/analyze', '재분석');
  if (target.closest('#kw-briefs')) runKwAction('/api/keywords/briefs', '브리프 생성');
  if (target.closest('#edit-save')) saveEdit();
  if (target.closest('#status-apply')) applyStatus();
  if (target.closest('[data-modal-close]')) {
    closeModal(target.closest('.admin-modal'));
  }
});

document.addEventListener('keydown', (event) => {
  const modal = document.querySelector('.admin-modal:not([hidden])');
  if (!modal) return;
  if (event.key === 'Escape') {
    closeModal(modal);
    return;
  }
  if (event.key !== 'Tab') return;
  const focusable = Array.from(modal.querySelectorAll('button, input, textarea, select, [href], [tabindex]:not([tabindex="-1"])'))
    .filter((element) => !element.hasAttribute('disabled') && !element.closest('[hidden]'));
  if (!focusable.length) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
});

statusSelectEl?.addEventListener('change', syncStatusFields);
