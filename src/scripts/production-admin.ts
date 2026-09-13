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
  status: "draft" | "scheduled" | "published";
  topic: "economy-business" | "ai" | "travel";
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

type ApiBody<T> = { ok: boolean; error?: string; data?: T };

const loginView = document.querySelector<HTMLElement>("#admin-login-view");
const dashboardView = document.querySelector<HTMLElement>(
  "#admin-dashboard-view",
);
const loginForm = document.querySelector<HTMLFormElement>("#admin-login-form");
const loginError = document.querySelector<HTMLElement>("#admin-login-error");
const dashboardError = document.querySelector<HTMLElement>(
  "#admin-dashboard-error",
);
const formError = document.querySelector<HTMLElement>("#admin-form-error");
const dashboardStatus = document.querySelector<HTMLElement>(
  "#admin-dashboard-status",
);
const postForm = document.querySelector<HTMLFormElement>("#admin-post-form");
const postRows =
  document.querySelector<HTMLTableSectionElement>("#admin-post-rows");
const keywordRows = document.querySelector<HTMLTableSectionElement>(
  "#admin-keyword-rows",
);
const postSearchInput =
  document.querySelector<HTMLInputElement>("#admin-post-search");
const statusFilter = document.querySelector<HTMLSelectElement>(
  "#admin-status-filter",
);
const topicFilter = document.querySelector<HTMLSelectElement>(
  "#admin-topic-filter",
);
const editor = document.querySelector<HTMLElement>("#admin-editor");
const editorTitle = document.querySelector<HTMLElement>("#admin-form-heading");
const editorPreview = document.querySelector<HTMLElement>(
  "#admin-body-preview",
);
const deleteButton =
  document.querySelector<HTMLButtonElement>("#admin-delete-post");

let state = Object.freeze({
  posts: [] as AdminPost[],
  keywords: [] as AdminKeyword[],
  editing: null as AdminPost | null,
  activeTab: "posts" as "posts" | "keywords",
});

const statusLabels: Record<AdminPost["status"], string> = {
  draft: "초안",
  scheduled: "예약",
  published: "공개",
};
const topicLabels: Record<AdminPost["topic"], string> = {
  "economy-business": "경제·비즈니스",
  ai: "AI",
  travel: "여행",
};

function field<
  T extends HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement,
>(id: string): T {
  const element = document.querySelector<T>(`#${id}`);
  if (!element) throw new Error(`Missing admin field: ${id}`);
  return element;
}

function setState(patch: Partial<typeof state>) {
  state = Object.freeze({ ...state, ...patch });
}

function show(element: HTMLElement | null, visible: boolean) {
  if (element) element.hidden = !visible;
}

function message(element: HTMLElement | null, value: string, visible = true) {
  if (!element) return;
  element.textContent = value;
  element.hidden = !visible;
}

function statusClass(status: AdminPost["status"]) {
  return `admin-status-pill admin-status-pill--${status}`;
}

async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    ...options,
    credentials: "include",
    headers: { Accept: "application/json", ...(options.headers ?? {}) },
  });
  let body: ApiBody<T>;
  try {
    body = (await response.json()) as ApiBody<T>;
  } catch {
    throw new Error("서버 응답을 읽을 수 없습니다.");
  }
  if (response.status === 401) {
    show(loginView, true);
    show(dashboardView, false);
  }
  if (!response.ok) {
    const errors: Record<string, string> = {
      authentication_required: "로그인이 필요합니다.",
      invalid_credentials: "비밀번호가 맞지 않습니다.",
      database_unavailable: "데이터베이스에 연결하지 못했습니다.",
      origin_not_allowed: "허용되지 않은 요청입니다.",
    };
    throw new Error(
      errors[body.error ?? ""] ?? body.error ?? "요청을 처리하지 못했습니다.",
    );
  }
  return body as T;
}

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? "-" : date.toLocaleDateString("ko-KR");
}

function localDateTime(value: string | null) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? "" : date.toISOString().slice(0, 16);
}

function renderMetrics() {
  const metrics = {
    all: state.posts.length,
    draft: state.posts.filter((post) => post.status === "draft").length,
    scheduled: state.posts.filter((post) => post.status === "scheduled").length,
    published: state.posts.filter((post) => post.status === "published").length,
  };
  for (const [key, value] of Object.entries(metrics)) {
    const element = document.querySelector<HTMLElement>(`#admin-metric-${key}`);
    if (element) element.textContent = String(value);
  }
  const postCount = document.querySelector<HTMLElement>("#admin-post-count");
  if (postCount) postCount.textContent = `${filteredPosts().length}개 표시`;
  const keywordCount = document.querySelector<HTMLElement>(
    "#admin-keyword-count",
  );
  if (keywordCount)
    keywordCount.textContent = `${state.keywords.length}개 기록`;
}

function filteredPosts() {
  const query = postSearchInput?.value.trim().toLowerCase() ?? "";
  const status = statusFilter?.value ?? "all";
  const topic = topicFilter?.value ?? "all";
  return state.posts.filter((post) => {
    const matchesQuery =
      !query ||
      [post.title, post.description, post.slug]
        .join(" ")
        .toLowerCase()
        .includes(query);
    return (
      matchesQuery &&
      (status === "all" || post.status === status) &&
      (topic === "all" || post.topic === topic)
    );
  });
}

function createCell(className = "") {
  const cell = document.createElement("td");
  if (className) cell.className = className;
  return cell;
}

function renderPosts() {
  if (!postRows) return;
  const posts = filteredPosts();
  const rows = posts.map((post) => {
    const row = document.createElement("tr");
    const main = createCell("admin-post-main");
    const title = document.createElement("strong");
    title.textContent = post.title;
    const description = document.createElement("small");
    description.textContent = post.description;
    const slug = document.createElement("code");
    slug.textContent = post.slug;
    main.append(title, description, slug);
    const status = createCell();
    const statusPill = document.createElement("span");
    statusPill.className = statusClass(post.status);
    statusPill.textContent = statusLabels[post.status];
    status.append(statusPill);
    const topic = createCell();
    const topicLabel = document.createElement("span");
    topicLabel.className = "admin-topic-label";
    topicLabel.textContent = topicLabels[post.topic] ?? post.topic;
    topic.append(topicLabel);
    const updated = createCell();
    const time = document.createElement("time");
    time.textContent = formatDate(post.updatedAt);
    updated.append(time);
    const actions = createCell("admin-row-actions");
    const edit = document.createElement("button");
    edit.className = "admin-text-button";
    edit.type = "button";
    edit.textContent = "편집";
    edit.addEventListener("click", () => openEditor(post));
    const remove = document.createElement("button");
    remove.className = "admin-text-button admin-text-button--danger";
    remove.type = "button";
    remove.textContent = "삭제";
    remove.addEventListener("click", () => void removePost(post));
    actions.append(edit, remove);
    row.append(main, status, topic, updated, actions);
    return row;
  });
  if (rows.length === 0) {
    const empty = document.createElement("tr");
    const cell = createCell("admin-empty");
    cell.colSpan = 5;
    cell.textContent = "조건에 맞는 글이 없습니다. 새 초안을 시작해 보세요.";
    empty.append(cell);
    rows.push(empty);
  }
  postRows.replaceChildren(...rows);
  renderMetrics();
}

function renderKeywords() {
  if (!keywordRows) return;
  const rows = state.keywords.map((keyword) => {
    const row = document.createElement("tr");
    const category = createCell();
    const categoryLabel = document.createElement("span");
    categoryLabel.className = "admin-topic-label";
    categoryLabel.textContent =
      topicLabels[keyword.category as AdminPost["topic"]] ?? keyword.category;
    category.append(categoryLabel);
    const keywordCell = createCell();
    const keywordText = document.createElement("strong");
    keywordText.textContent = keyword.headKeyword;
    keywordCell.append(keywordText);
    const status = createCell();
    const statusText = document.createElement("span");
    statusText.className = "admin-keyword-status";
    statusText.textContent = keyword.status;
    status.append(statusText);
    const collected = createCell();
    const time = document.createElement("time");
    time.textContent = formatDate(keyword.collectedAt);
    collected.append(time);
    row.append(category, keywordCell, status, collected);
    return row;
  });
  keywordRows.replaceChildren(...rows);
  renderMetrics();
}

function updatePreview() {
  if (editorPreview)
    editorPreview.textContent =
      field<HTMLTextAreaElement>("admin-body").value ||
      "본문을 입력하면 여기에 미리 표시됩니다.";
}

function openEditor(post: AdminPost | null) {
  setState({ editing: post });
  editorTitle!.textContent = post ? "글 편집" : "새 초안";
  field<HTMLInputElement>("admin-slug").value = post?.slug ?? "";
  field<HTMLInputElement>("admin-slug").disabled = Boolean(post);
  field<HTMLSelectElement>("admin-status").value = post?.status ?? "draft";
  field<HTMLInputElement>("admin-title").value = post?.title ?? "";
  field<HTMLSelectElement>("admin-topic").value = post?.topic ?? "ai";
  field<HTMLInputElement>("admin-description").value = post?.description ?? "";
  field<HTMLInputElement>("admin-pub-date").value =
    post?.pubDate ?? new Date().toISOString().slice(0, 10);
  field<HTMLInputElement>("admin-publish-at").value = localDateTime(
    post?.publishAt ?? null,
  );
  field<HTMLInputElement>("admin-author").value = post?.author ?? "WJ Blog";
  field<HTMLInputElement>("admin-tested-at").value =
    post?.metadata?.testedAt ?? "";
  field<HTMLInputElement>("admin-angle").value = post?.angle ?? "";
  field<HTMLTextAreaElement>("admin-body").value = post?.bodyMarkdown ?? "";
  show(deleteButton, Boolean(post));
  message(formError, "", false);
  updatePreview();
  show(editor, true);
  editor?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function closeEditor() {
  show(editor, false);
  setState({ editing: null });
}

async function removePost(post: AdminPost) {
  if (!window.confirm(`“${post.title}”을 Neon에서 삭제할까요?`)) return;
  try {
    await api(`/api/admin/posts/${encodeURIComponent(post.slug)}`, {
      method: "DELETE",
    });
    message(dashboardStatus, "글을 삭제했습니다.");
    await loadDashboard();
  } catch (error) {
    message(
      dashboardError,
      error instanceof Error ? error.message : "삭제에 실패했습니다.",
    );
  }
}

async function loadDashboard() {
  message(dashboardError, "", false);
  const [postsResponse, keywordsResponse] = await Promise.all([
    api<{ data: AdminPost[] }>("/api/admin/posts"),
    api<{ data: AdminKeyword[] }>("/api/admin/keywords"),
  ]);
  setState({
    posts: postsResponse.data ?? [],
    keywords: keywordsResponse.data ?? [],
  });
  renderPosts();
  renderKeywords();
  message(
    dashboardStatus,
    `${state.posts.length}개 글과 ${state.keywords.length}개 키워드를 불러왔습니다.`,
  );
}

function setTab(tab: "posts" | "keywords") {
  setState({ activeTab: tab });
  for (const name of ["posts", "keywords"] as const) {
    const button = document.querySelector<HTMLButtonElement>(
      `#admin-tab-${name}`,
    );
    const panel = document.querySelector<HTMLElement>(`#admin-panel-${name}`);
    const active = name === tab;
    button?.classList.toggle("is-active", active);
    button?.setAttribute("aria-selected", String(active));
    show(panel, active);
  }
}

loginForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  message(loginError, "", false);
  try {
    await api("/api/admin/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        password: field<HTMLInputElement>("admin-password").value,
      }),
    });
    loginForm.reset();
    show(loginView, false);
    show(dashboardView, true);
    await loadDashboard();
  } catch (error) {
    message(
      loginError,
      error instanceof Error ? error.message : "로그인에 실패했습니다.",
    );
  }
});

document
  .querySelector<HTMLButtonElement>("#admin-logout")
  ?.addEventListener("click", async () => {
    await api("/api/admin/logout", { method: "POST" });
    show(loginView, true);
    show(dashboardView, false);
  });
document
  .querySelector<HTMLButtonElement>("#admin-refresh")
  ?.addEventListener("click", () => void loadDashboard());
document
  .querySelector<HTMLButtonElement>("#admin-new-post")
  ?.addEventListener("click", () => openEditor(null));
document
  .querySelector<HTMLButtonElement>("#admin-cancel-edit")
  ?.addEventListener("click", closeEditor);
document
  .querySelector<HTMLButtonElement>("#admin-cancel-edit-bottom")
  ?.addEventListener("click", closeEditor);
document
  .querySelector<HTMLButtonElement>("#admin-delete-post")
  ?.addEventListener("click", () => {
    if (state.editing) void removePost(state.editing).then(closeEditor);
  });
postSearchInput?.addEventListener("input", renderPosts);
statusFilter?.addEventListener("change", renderPosts);
topicFilter?.addEventListener("change", renderPosts);
for (const tab of ["posts", "keywords"] as const) {
  document
    .querySelector<HTMLButtonElement>(`#admin-tab-${tab}`)
    ?.addEventListener("click", () => setTab(tab));
}
field<HTMLTextAreaElement>("admin-body")?.addEventListener(
  "input",
  updatePreview,
);

postForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  message(formError, "", false);
  const publishAt = field<HTMLInputElement>("admin-publish-at").value;
  const payload = {
    slug: field<HTMLInputElement>("admin-slug").value,
    title: field<HTMLInputElement>("admin-title").value,
    description: field<HTMLInputElement>("admin-description").value,
    pubDate: field<HTMLInputElement>("admin-pub-date").value,
    publishAt: publishAt || null,
    status: field<HTMLSelectElement>("admin-status").value,
    topic: field<HTMLSelectElement>("admin-topic").value,
    angle: field<HTMLInputElement>("admin-angle").value,
    author: field<HTMLInputElement>("admin-author").value,
    testedAt: field<HTMLInputElement>("admin-tested-at").value || null,
    bodyMarkdown: field<HTMLTextAreaElement>("admin-body").value,
    metadata: state.editing?.metadata ?? {},
  };
  try {
    await api("/api/admin/posts", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    closeEditor();
    message(dashboardStatus, "글을 저장했습니다.");
    await loadDashboard();
  } catch (error) {
    message(
      formError,
      error instanceof Error ? error.message : "저장에 실패했습니다.",
    );
  }
});

void api<{ authenticated: boolean }>("/api/admin/session")
  .then((session) => {
    show(loginView, !session.authenticated);
    show(dashboardView, session.authenticated);
    if (session.authenticated) return loadDashboard();
    return undefined;
  })
  .catch((error) =>
    message(
      loginError,
      error instanceof Error
        ? error.message
        : "관리자 상태를 확인할 수 없습니다.",
    ),
  );
