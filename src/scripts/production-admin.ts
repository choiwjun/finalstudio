type AdminMetadata = {
  testedAt?: string | null;
  sourceIds?: string[];
};

type AdminPost = {
  slug: string;
  title: string;
  description: string;
  pubDate: string;
  publishAt: string | null;
  status: string;
  topic: string;
  angle: string;
  author: string;
  bodyMarkdown: string;
  metadata: AdminMetadata;
  updatedAt: string;
};

type AdminKeyword = {
  category: string;
  headKeyword: string;
  status: string;
  collectedAt: string;
};

const loginView = document.querySelector<HTMLElement>('#admin-login-view');
const dashboardView = document.querySelector<HTMLElement>('#admin-dashboard-view');
const loginForm = document.querySelector<HTMLFormElement>('#admin-login-form');
const loginError = document.querySelector<HTMLElement>('#admin-login-error');
const dashboardError = document.querySelector<HTMLElement>('#admin-dashboard-error');
const formError = document.querySelector<HTMLElement>('#admin-form-error');
const dashboardStatus = document.querySelector<HTMLElement>('#admin-dashboard-status');
const postForm = document.querySelector<HTMLFormElement>('#admin-post-form');
const postRows = document.querySelector<HTMLTableSectionElement>('#admin-post-rows');
const keywordRows = document.querySelector<HTMLTableSectionElement>('#admin-keyword-rows');
const state: { posts: AdminPost[]; editing: AdminPost | null } = { posts: [], editing: null };

function field<T extends HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(id: string): T {
  const element = document.querySelector<T>(`#${id}`);
  if (!element) throw new Error(`Missing admin field: ${id}`);
  return element;
}

function show(element: HTMLElement | null, visible: boolean) {
  if (element) element.hidden = !visible;
}

function setMessage(element: HTMLElement | null, message: string, visible = true) {
  if (!element) return;
  element.textContent = message;
  element.hidden = !visible;
}

async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(path, { ...options, credentials: 'include', headers: { Accept: 'application/json', ...(options.headers ?? {}) } });
  let body: { error?: string } & T;
  try {
    body = await response.json() as { error?: string } & T;
  } catch {
    throw new Error('서버 응답을 읽을 수 없습니다.');
  }
  if (response.status === 401) {
    show(loginView, true);
    show(dashboardView, false);
  }
  if (!response.ok) throw new Error(body.error ?? '요청을 처리하지 못했습니다.');
  return body;
}

function localDateTime(value: string | null) {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? '' : date.toISOString().slice(0, 16);
}

function renderPosts(posts: AdminPost[]) {
  postRows?.replaceChildren(...posts.map((post) => {
    const row = document.createElement('tr');
    const title = document.createElement('td');
    title.textContent = post.title;
    const status = document.createElement('td');
    status.textContent = post.status;
    const topic = document.createElement('td');
    topic.textContent = post.topic;
    const updated = document.createElement('td');
    updated.textContent = new Date(post.updatedAt).toLocaleString('ko-KR');
    const action = document.createElement('td');
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = '편집';
    button.addEventListener('click', () => editPost(post));
    action.append(button);
    row.append(title, status, topic, updated, action);
    return row;
  }) ?? []);
}

function renderKeywords(keywords: AdminKeyword[]) {
  keywordRows?.replaceChildren(...keywords.map((keyword) => {
    const row = document.createElement('tr');
    for (const value of [keyword.category, keyword.headKeyword, keyword.status, new Date(keyword.collectedAt).toLocaleDateString('ko-KR')]) {
      const cell = document.createElement('td');
      cell.textContent = value;
      row.append(cell);
    }
    return row;
  }) ?? []);
}

function editPost(post: AdminPost | null) {
  state.editing = post;
  field<HTMLInputElement>('admin-slug').value = post?.slug ?? '';
  field<HTMLInputElement>('admin-title').value = post?.title ?? '';
  field<HTMLInputElement>('admin-description').value = post?.description ?? '';
  field<HTMLInputElement>('admin-pub-date').value = post?.pubDate ?? new Date().toISOString().slice(0, 10);
  field<HTMLInputElement>('admin-publish-at').value = localDateTime(post?.publishAt ?? null);
  field<HTMLSelectElement>('admin-status').value = post?.status ?? 'draft';
  field<HTMLInputElement>('admin-topic').value = post?.topic ?? 'ai';
  field<HTMLInputElement>('admin-angle').value = post?.angle ?? '';
  field<HTMLInputElement>('admin-author').value = post?.author ?? '';
  field<HTMLInputElement>('admin-tested-at').value = post?.metadata?.testedAt ?? '';
  field<HTMLTextAreaElement>('admin-body').value = post?.bodyMarkdown ?? '';
  setMessage(formError, '', false);
  show(postForm, true);
  postForm?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function loadDashboard() {
  setMessage(dashboardError, '', false);
  const [posts, keywords] = await Promise.all([
    api<{ data: AdminPost[] }>('/api/admin/posts'),
    api<{ data: AdminKeyword[] }>('/api/admin/keywords'),
  ]);
  state.posts = posts.data;
  renderPosts(posts.data);
  renderKeywords(keywords.data);
  setMessage(dashboardStatus, `${posts.data.length}개 글과 ${keywords.data.length}개 키워드를 불러왔습니다.`);
}

loginForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  setMessage(loginError, '', false);
  const password = field<HTMLInputElement>('admin-password').value;
  try {
    await api('/api/admin/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }) });
    loginForm.reset();
    show(loginView, false);
    show(dashboardView, true);
    await loadDashboard();
  } catch (error) {
    setMessage(loginError, error instanceof Error ? error.message : '로그인에 실패했습니다.');
  }
});

document.querySelector<HTMLButtonElement>('#admin-logout')?.addEventListener('click', async () => {
  await api('/api/admin/logout', { method: 'POST' });
  show(loginView, true);
  show(dashboardView, false);
});

document.querySelector<HTMLButtonElement>('#admin-refresh')?.addEventListener('click', () => void loadDashboard().catch((error) => setMessage(dashboardError, error instanceof Error ? error.message : '새로고침에 실패했습니다.')));
document.querySelector<HTMLButtonElement>('#admin-new-post')?.addEventListener('click', () => editPost(null));
document.querySelector<HTMLButtonElement>('#admin-cancel-edit')?.addEventListener('click', () => show(postForm, false));

postForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  setMessage(formError, '', false);
  const metadata = state.editing?.metadata ?? {};
  const publishAt = field<HTMLInputElement>('admin-publish-at').value;
  const payload = {
    slug: field<HTMLInputElement>('admin-slug').value,
    title: field<HTMLInputElement>('admin-title').value,
    description: field<HTMLInputElement>('admin-description').value,
    pubDate: field<HTMLInputElement>('admin-pub-date').value,
    publishAt: publishAt || null,
    status: field<HTMLSelectElement>('admin-status').value,
    topic: field<HTMLInputElement>('admin-topic').value,
    angle: field<HTMLInputElement>('admin-angle').value,
    author: field<HTMLInputElement>('admin-author').value,
    testedAt: field<HTMLInputElement>('admin-tested-at').value || null,
    bodyMarkdown: field<HTMLTextAreaElement>('admin-body').value,
    metadata,
  };
  try {
    await api('/api/admin/posts', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    show(postForm, false);
    await loadDashboard();
  } catch (error) {
    setMessage(formError, error instanceof Error ? error.message : '저장에 실패했습니다.');
  }
});

void api<{ authenticated: boolean }>('/api/admin/session')
  .then((session) => {
    show(loginView, !session.authenticated);
    show(dashboardView, session.authenticated);
    if (session.authenticated) return loadDashboard();
    return undefined;
  })
  .catch((error) => setMessage(loginError, error instanceof Error ? error.message : '관리자 상태를 확인할 수 없습니다.'));
