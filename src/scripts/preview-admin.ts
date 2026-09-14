import { renderMarkdownPreview } from "./markdown-preview";

type AdminPost = {
  slug: string;
  title: string;
  description: string;
  pubDate: string;
  publishAt: string | null;
  status: "draft" | "scheduled" | "published";
  topic: string;
  author: string;
  bodyMarkdown: string;
  updatedAt: string;
};

type ApiBody<T> = { ok: boolean; error?: string; data?: T };

const loginView = document.querySelector<HTMLElement>("#preview-login-view");
const previewView = document.querySelector<HTMLElement>("#preview-view");
const loginForm =
  document.querySelector<HTMLFormElement>("#preview-login-form");
const loginError = document.querySelector<HTMLElement>("#preview-login-error");
const previewError = document.querySelector<HTMLElement>("#preview-error");
const previewStatus = document.querySelector<HTMLElement>("#preview-status");
const previewToc = document.querySelector<HTMLElement>("#preview-toc");
const previewPosts = document.querySelector<HTMLElement>("#preview-posts");

const statusLabels: Record<AdminPost["status"], string> = {
  draft: "초안",
  scheduled: "예약",
  published: "공개",
};

function show(element: HTMLElement | null, visible: boolean) {
  if (element) element.hidden = !visible;
}

function message(element: HTMLElement | null, value: string, visible = true) {
  if (!element) return;
  element.textContent = value;
  element.hidden = !visible;
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
    show(previewView, false);
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

function renderPosts(posts: AdminPost[]) {
  if (!previewPosts || !previewToc) return;
  const drafts = posts.filter((post) => post.status !== "published");
  if (drafts.length === 0) {
    previewPosts.innerHTML =
      '<p class="preview-empty">검토 대기 중인 초안이 없습니다.</p>';
    show(previewToc, false);
    return;
  }
  const links = drafts.map(
    (post) =>
      `<a href="#post-${post.slug}">${post.title.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</a>`,
  );
  previewToc.innerHTML = links.join("");
  show(previewToc, true);
  previewPosts.innerHTML = drafts
    .map(
      (post) => `<article class="preview-post" id="post-${post.slug}">
  <header class="preview-post-header">
    <h2>${post.title.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</h2>
    <div class="preview-post-meta">
      <span class="admin-status-pill admin-status-pill--${post.status}">${statusLabels[post.status] ?? post.status}</span>
      <span>${post.slug}.md</span>
      <span>게시일 ${formatDate(post.pubDate)}</span>
      ${post.publishAt ? `<span>예약 ${formatDate(post.publishAt)}</span>` : ""}
      <span>${post.author}</span>
    </div>
  </header>
  <div class="preview-body">${renderMarkdownPreview(post.bodyMarkdown)}</div>
</article>`,
    )
    .join("");
  if (window.location.hash) {
    document
      .querySelector<HTMLElement>(window.location.hash)
      ?.scrollIntoView({ block: "start" });
  }
}

async function loadPreview() {
  message(previewError, "", false);
  const response = await api<{ data: AdminPost[] }>("/api/admin/posts");
  const posts = response.data ?? [];
  renderPosts(posts);
  message(
    previewStatus,
    `검토 대기 중인 글 ${posts.filter((post) => post.status !== "published").length}개를 불러왔습니다.`,
  );
}

loginForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  message(loginError, "", false);
  try {
    await api("/api/admin/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        password:
          document.querySelector<HTMLInputElement>("#preview-password")
            ?.value ?? "",
      }),
    });
    loginForm.reset();
    show(loginView, false);
    show(previewView, true);
    await loadPreview();
  } catch (error) {
    message(
      loginError,
      error instanceof Error ? error.message : "로그인에 실패했습니다.",
    );
  }
});

document
  .querySelector<HTMLButtonElement>("#preview-logout")
  ?.addEventListener("click", async () => {
    await api("/api/admin/logout", { method: "POST" });
    show(loginView, true);
    show(previewView, false);
  });
document
  .querySelector<HTMLButtonElement>("#preview-refresh")
  ?.addEventListener("click", () => void loadPreview());

void api<{ authenticated: boolean }>("/api/admin/session")
  .then((session) => {
    show(loginView, !session.authenticated);
    show(previewView, session.authenticated);
    if (session.authenticated) return loadPreview();
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
