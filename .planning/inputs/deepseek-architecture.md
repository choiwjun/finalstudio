# Technical Architecture & Feasibility — SEO-first AdSense Blog
**Pod:** Technical architecture / feasibility (independent planning input)
**Date:** 2026-09 (vendor facts verified against official docs/pricing pages at retrieval time; anything not verified is labeled UNKNOWN)
**Scope:** Compare **A) Cloudflare + Neon** vs **B) Supabase + Vercel** for a from-scratch, SEO-first, Google-AdSense-monetized blog with automated drafting/review/publishing. No code was implemented; no credentials were used.

---

## 0. Framing (assumptions, evidence base)

The blog repo is empty (`main`, no files). Business goal: AdSense revenue. That goal is **content-driven, not infrastructure-driven**. The infrastructure decision therefore should minimize (a) per-request/per-egress cost growth with traffic, (b) operational surface, (c) anything that hurts crawl/index/uptime, and (d) lock-in — while preserving hooks for the automation pipeline.

Assumptions (labeled; correct if wrong):
- **A1.** Publishing is human-reviewed automation: an AI drafts, a human approves, then the post ships. Not a public write-API product.
- **A2.** Blog is mostly read-only public content. Little or no per-user auth; interactive features (comments, member areas, newsletter) are possible later but are not core day 1.
- **A3.** Content is stored as Markdown in Git ("content-as-code") — the single source of truth — rather than living only in a database. This is the single biggest portability/cost lever.
- **A4.** Audience/language UNKNOWN; likely Korean or English (inferable from operator locale but unconfirmed). Seoul-region latency and Google Korea visibility are plausible requirements → treat as a gate, not a given.
- **A5.** "Verified" below = read from an official vendor docs/pricing page on 2026-09. "UNKNOWN" = not verified; do not rely on it.

---

## 1. Findings — comparison by dimension

### 1.1 Rendering / deployment
| Aspect | A: Cloudflare (+Neon) | B: Vercel (+Supabase) |
|---|---|---|
| Static-first blog fit | Excellent. Cloudflare Pages: 20,000 files/site free, 500 builds/mo free (1 concurrent build); paid plans 100k files, 5,000–20,000 builds. Static assets served from the CDN edge; **only Pages Functions count against the Workers request quota** | Excellent. Deployments 100/day on Hobby (6,000 on Pro); static output served from CDN; Vercel is the reference host for Next.js |
| Framework fit | Any SSG. Astro/11ty/static Next.js all work. Next.js server features need adapter (`@opennextjs-cloudflare`) or static export — an extra layer | Next.js first-class (ISR/PPR/OG image etc.); Astro also supported |
| SEO-relevant control | Full control of `robots.txt`, `sitemap.xml`, redirects, `_headers`; rollback to a previous deployment is a click; preview URLs per PR | Same; preview deployments per PR; instant rollback; redirects/headers config-first |
| Free-tier request ceiling | Workers **Free: 100,000 requests/day** (resets UTC midnight; static assets on Pages do not consume this). Workers **Paid: from $5/mo**, 10M requests included, +$0.30/M | Hobby: 1M function invocations + 100 GB fast data transfer/mo included; **edge requests 1M/mo included** (per Vercel pricing page) |
| TTFB | Global CDN, zero cold start for static | Static: CDN; dynamic functions may cold start (Fluid Compute mitigates on Pro) |

**Reading:** For a static-first SEO blog both are excellent and roughly equivalent at low traffic. The structural differences that matter are DB/serving, scheduled work, and cost shape (below).

### 1.2 Database / auth / storage needs
Content-as-code removes the need for a content DB entirely at read time. Remaining DB need: **draft/review/publish workflow state** (status, review comments, scheduled dates, audit trail) plus optional counters. That is tiny.

| | A: Neon | B: Supabase |
|---|---|---|
| Engine | Managed Postgres (standard wire protocol; storage–compute separation, branching) | Managed Postgres + auto REST/GraphQL API + Auth + Storage buckets + Realtime + pg_cron, on AWS |
| Free tier (verified) | 0.5 GB storage/project, 100 CU-hours/project/mo, scale-to-zero after 5 min idle, 10 branches/project, 5 GB transfer/project, 1-day monitoring | 500 MB DB (read-only mode when exceeded), 1 GB file storage, 5 GB egress, 50k MAU, unlimited API requests, 1-day log retention; **project pauses after 1 week of inactivity** (Free) |
| First paid step | Launch is usage-based, **no minimum** ($0.106/CU-hr, $0.35/GB-mo, 500 GB transfer incl. then $0.10/GB; scale-to-zero can be disabled). Vendor "typical $15/mo" example for intermittent 1 GB load — vendor illustration, treat as indicative | Pro **$25/mo** (first project) incl. $10 compute credit = one Micro instance (2-core shared, 1 GB RAM, 10 GB max DB); 250 GB egress then $0.09/GB; daily backups 7 days; email support |
| Backup/recovery | Branching + history window (6 h free / 7 d Launch), snapshots (1 free / 100 Launch), instant restore $0.20/GB-mo (Launch) | Pro: daily backups, 7-day retention. PITR tier = UNKNOWN (not verified) |
| Auth | None built-in (BYO auth, e.g. an admin token / GitHub login) | First-class Auth + RLS — fast path if admin accounts/comments/membership are needed |
| Storage | Neon Object Storage is Beta (pricing free during beta) — do not build on beta | Supabase Storage GA-ish, 1 GB free / $0.0213 per GB after |
| Operational feel | A database product; you wire it yourself | An app backend platform; batteries included |

**Reading:** If interactive features (admin auth, comments, newsletters, RLS data) are needed soon, Supabase collapses 3 services into 1 and B gets stronger. If the DB is only workflow state behind an automated pipeline, Supabase's breadth is unused weight; Neon is cheaper and more portable, and its **scale-to-zero** matches an idle-but-scheduled workflow. Supabase Free's **1-week pause is disqualifying** for any DB-backed always-on serving on the free tier; on Pro the DB is always on but costs $25/mo. Neon free also scales to zero — but cold-start latency applies on first query after idle (350 ms class; actual = UNKNOWN), which only affects background/authoring paths if content is served statically.

### 1.3 Scheduled jobs / automation hooks
Automation (AI drafting, review nudges, publishing) is best run **outside the hosting platform** — in GitHub Actions — because it is identical for both options and keeps the pipeline portable. Platform cron is then only a fallback.

- GitHub Actions (verified): free accounts get **2,000 min/mo on private repos**; public repos free. One static build + deploy is a few minutes → hundreds of builds/mo within free quota.
- A path: Cloudflare Pages **Deploy Hooks** let the pipeline trigger builds remotely. Workers **Cron Triggers**: free 5/account, paid 250/account; free CPU per cron 10 ms, paid up to 30 s (<1 h interval) / 15 min (≥1 h). CF Pages **500 builds/mo free**.
- B path: Vercel **Cron Jobs**: Hobby limited to **once per day** per job (per-hour precision ±59 min); Pro: every minute. Vercel Deploy Hooks: 5 (Hobby) / 10 (Pro) per project. Hobby deployments 100/day.
- Rebuild-on-publish is the only strictly-needed schedule (e.g. 1–2/day max). Both options handle it; Vercel's Hobby cron is adequate, Cloudflare's free cron quota (5) is adequate.

### 1.4 Edge/server functions and dynamic needs
- A: Workers (V8 isolates) — global by default. Free CPU 10 ms/request is tight for SSR of a dynamic page but irrelevant for static output. Paid: 5 min CPU. Analytics Engine (3-month retention) for counters.
- B: Vercel Functions — Node runtime, region-selectable (Seoul region = UNKNOWN, verify), Fluid Compute on Pro; Hobby invocations included 1M, overage $0.6/M (Pro rates) per pricing page.
- Minimal architecture needs **zero** functions at request time if pages are pre-rendered; a tiny function may be wanted later for: dynamic sitemap edge cases, Outbound-links, an AdSense-adjacent utility, or comment submissions.

### 1.5 Observability
- A: CF dashboard metrics, **Workers Logs: Free 200k/day with 3-day retention; Paid 20M/mo +$0.60/M, 7-day retention**; Logpush (paid); Analytics Engine 3-month; **Cloudflare Web Analytics free** (privacy-friendly, SEO-side is Search Console anyway).
- B: Vercel: function logs + Web Analytics/Speed Insights (event-based pricing beyond included; details UNKNOWN beyond pricing page's $3/1k Web Analytics events); **Supabase: 1-day log retention Free, 7-day Pro**; Neon: 1-day Free / 3-day Launch / 14-day Scale monitoring.
- Real SEO observability lives in **Google Search Console + PageSpeed/CrUX**, which are platform-neutral. Both platforms are adequate; neither is a differentiator.

### 1.6 Portability
- **Content Markdown in Git** = fully portable regardless of stack (the main lever).
- Neon: standard Postgres → migrate anywhere with `pg_dump`; no proprietary serving API required. Most portable DB choice here.
- Supabase: Postgres core + proprietary layers (Auth/Storage/Realtime/auto-API). Self-hostable OSS, but you are adopting a platform. If you use only the Postgres connection, portability is fine.
- Cloudflare Workers: `workerd` is open source; no-egress R2 is S3-compatible; but bindings (KV/D1/Queues) are platform-specific → **avoid using them** under this architecture.
- Vercel: Next.js is portable to Node hosts, but ISR/fluid/OG-image semantics are Vercel-flavored; static export loses the fancy parts. If you pick Next.js *and* B, expect moderate lock-in.
- **Decision hygiene:** standard Postgres + static SSG keeps both doors open. The platform decision then becomes reversible at content-hosting level in days, not months.

### 1.7 Likely cost drivers (verified numbers; sums are estimates)
Blog traffic pattern: many cheap static views + tiny DB + few builds.

| | A: Cloudflare + Neon | B: Vercel + Supabase |
|---|---|---|
| Month 1 (low traffic) | **~$0** (CF free + Neon free) | **~$0** (Vercel Hobby + Supabase Free) — *but Supabase project pauses after 1 week idle; fine for staging, wrong for serving* |
| First cost step | Workers Paid **$5/mo min** (only if you need functions/cron beyond free); Neon Launch usage-only, no min | Supabase **Pro $25/mo** (always-on DB, backups) and/or Vercel **Pro $20/mo**; Hobby stays free if you accept limits |
| Traffic scale-up driver | CF Workers request volume ($0.30/M over 10M incl.) — static assets effectively free; **no egress fees anywhere (R2/Pages)** | Vercel fast data transfer 100 GB (Hobby) / 1 TB (Pro incl. credit), then ~$0.15/GB; function invocations; **Supabase egress 250 GB then $0.09/GB** |
| DB driver | Neon CU-hours & storage; scale-to-zero keeps it near $0 at rest | Supabase compute is per-hour always-on (Micro ~$10/mo effectively covered by Pro credit) |
| Hidden cost to watch | Workers Free daily 100k request cap (mostly a crawler/abuse risk, not a real-traffic risk at blog scale) | Vercel "usage-based" surprise billing past included credit on Pro; egress at scale |

**Estimate for a healthy blog (~10–100k pageviews/mo, mostly static):** A ≈ $0–6/mo; B ≈ $0 (Hobby) or $20–45/mo (Pro). At higher traffic with dynamic functions, B can materially exceed A because of egress + invocation + always-on compute, but at static-only traffic both stay cheap. These are estimates, not quotes — vendor pricing pages were the evidence.

### 1.8 Operational complexity & failure/recovery
- A components: DNS/CDN+host (Cloudflare) + Postgres (Neon). Two vendors, one of which is also your DNS/CDN/edge. Neon scale-to-zero, branching, instant restore; CF Pages versioned deployments + instant rollback. Complexity: low-moderate (wrangler config, Neon schema migrations).
- B components: host (Vercel) + platform backend (Supabase) — two vendors, each multi-service. Supabase dashboard does a lot for you; Vercel + Supabase is a very common, well-trodden pair with ready-made templates. Complexity: low-moderate, arguably lower for auth/backend features.
- Failure posture: static hosting failure modes are small in both. DB failure is the larger risk in B's *platform* framing (auth/gateway single-vendor), while A keeps the DB as an ordinary Postgres you can repoint. Recovery: A — Neon branches/PITR-style history + CF rollback; B — Supabase 7-day backups + Vercel rollback (PITR UNKNOWN).
- One-vendor observation: B concentrates more app surface in Supabase; A concentrates more network surface in Cloudflare. Neither is a stability red flag (status pages at retrieval: CF regional maintenance items listed, Vercel/Supabase/Neon "operational" overall).

---

## 2. Recommendation

**Adopt Option A — Cloudflare + Neon — with a static-first, content-as-code architecture, and treat interactive features as an explicit escape hatch to Option B.**

Minimal target architecture:
1. **Git repo** = single source of truth: Markdown posts + front-matter (title, slug, dates, status, canonical, tags), images, config.
2. **Framework:** static SSG **Astro** (or 11ty) — deliberately *not* Next.js-server — because its output is identical static files that deploy identically to Cloudflare Pages **and** Vercel, preserving the B door.
3. **Hosting:** Cloudflare Pages on the free tier; enable Workers Paid ($5/mo) only when functions/cron/logs are actually needed. Pages gives CDN, rollbacks, preview deployments, redirects/headers.
4. **DB:** Neon (free → Launch), used *only* for authoring/workflow state (drafts, review status/comments, publish schedule, audit) behind the pipeline, **never on the read path** for public pages. Keep everything else out of Neon.
5. **Pipeline:** GitHub Actions as scheduler/orchestrator for the AI draft → human review → publish flow: draft commits to a review branch; human approves via PR/issue/label (or a tiny review board UI); merge triggers Pages build via Deploy Hook; Neon updates status. Sitemap/RSS/JSON-LD generated at build.
6. **SEO plumbing at build:** `sitemap.xml`, `robots.txt`, canonical URLs, clean permalinks, hreflang only if multi-language (UNKNOWN), structured data (Article/BreadcrumbList), generated `og:` images if cheap, hash-named assets with long cache + short HTML cache headers.
7. **Ads:** AdSense code injected at build via partial; no client framework needed on posts.

Why A wins for this specific goal:
- **Cost shape matches a content business**: static views are essentially free and **egress-free** on Cloudflare; B monetizes traffic later through egress/invocations. AdSense pays per impression — thin margins; don't hand a cut to egress.
- **DB matches the actual need**: tiny workflow-state Postgres; Neon scale-to-zero + no-minimum usage pricing fits an automated-but-idle pipeline. Supabase Free pauses (bad) and Pro costs $25/mo for features the pipeline doesn't need.
- **Fewer moving parts on the serving path**: static files, not functions; the read path has no database, no auth gateway, no cold starts.
- **Portability is preserved** by construction (Git content + standard Postgres + portable SSG), so the choice is *not* final and the risk of lock-in is low.
- Supabase+Vercel's real advantages — turnkey auth/storage/admin, Next.js ISR, one-panel backend — are only worth paying for if interactivity becomes core.

**Escape hatch (when to switch to B):** first durable requirement for per-user accounts/RLS-protected data, comments with moderation at scale, newsletter/member gating, or heavy per-page dynamic data → re-plan with Supabase+Vercel. The content repo and Postgres data move as-is; only the host/adapter changes.

---

## 3. Alternatives
1. **B as chosen now (Supabase + Vercel + Next.js)** — best when the team wants the fastest path to admin/auth/backend features and accepts $20–45/mo once off-Hobby, Vercel/Next.js flavored lock-in, and egress cost at scale. If the operator is already fluent in Next.js, this is the pragmatic pick; A's static/edge tooling has a learning curve.
2. **Pure static + no DB at all** (Cloudflare Pages only; workflow state in PRs/issues/Git) — lowest ops and cost; loses structured review history and scheduled-publish bookkeeping. Viable until the pipeline needs a state store.
3. **Cloudflare D1/KV instead of Neon** — cheaper still, but SQLite-on-edge + KV are platform bindings; worse portability and (for D1) less mature tooling than Postgres. Rejected under the portability rule; revisit only if Neon cost ever matters (unlikely at this scale).
4. **Contentful/Sanity headless CMS** — rejected for cost and for moving content out of Git (AdSense wants unique original content; a CMS adds no SEO edge here).

---

## 4. Risks
1. **Content risk (highest, non-infra):** AdSense approval is at Google's discretion; Google publishes no traffic/approval thresholds (no public threshold = UNKNOWN). Thin, templated, or AI-slop content invites rejection — AdSense policy emphasizes high-quality unique content and full HTML-source access to the site. **Infra cannot fix this.** Gate publishing volume on quality review (the human-in-the-loop is a compliance feature, not overhead).
2. **Worker Free daily cap** (100k requests/day across the account incl. cron/functions): a burst of crawler abuse or a viral page could 1027-error pages handled by Workers. Mitigation: static Pages assets don't count; cache aggressively; upgrade to $5 Paid at the first sign.
3. **Scale-to-zero cold starts** on Neon if any read path touches the DB (design rule forbids it; authoring tools can tolerate ~0.3–1 s).
4. **Vercel usage-billing surprise** (B path): Hobby limits are fine, but Pro's overage pricing is pay-as-you-go — set spend alerts. (B risk only if B chosen.)
5. **Supabase Free pause** (B path): any DB-backed dynamic serving on Free goes dark after 1 week idle.
6. **Build quota exhaustion**: CF Pages free = 500 builds/mo. A per-post rebuild is fine; naive per-commit rebuilds on a busy repo are not. Batch or gate builds.
7. **Duplicate-content/canonical drift** between preview domains and production, or www vs apex — standard SEO ops, but automate a canonical check in CI.
8. **LLM-draft disclosure/E-E-A-T**: not an infra risk, but a review-gate requirement; Google's exact stance on AI content = UNKNOWN/evolving; mitigation = human review + experience/authority signals.
9. **Vendor drift:** docs I verified are current as of 2026-09; limits change (e.g., free tiers). Re-verify at decision time, not at report time.

---

## 5. Decision criteria (explicit gates)
Gate 0 — **Topic & audience (do first, blocking):** pick the 1–3 durable topics and language/region. Determines region choice, keyword plan, and AdSense eligibility language checks. Gate fails if topics are chosen for "ad RPM" rather than durable search demand + writer competence.
Gate 1 — **Framework portability (day 1):** adopt a static SSG whose output builds identically on Cloudflare Pages and Vercel (Astro/11ty). If the team insists on Next.js server features → reroute to B and accept the lock-in.
Gate 2 — **Read-path purity:** public pages must never hit the DB at request time. Violation of this gate is the #1 sign to stop and re-architect (cold starts, Worker CPU caps, always-on DB cost).
Gate 3 — **AdSense readiness by day ~25:** site is crawlable, has sitemap + unique substantial content (≥15–30 posts is a common practitioner heuristic — UNOFFICIAL/UNKNOWN), HTML-source access confirmed, policies reviewed. Apply; treat approval as a funnel gate, not a milestone.
Gate 4 — **Cost gates:** stay on free tiers until either (a) Workers request volume approaches 100k/day → move to Paid $5/mo; or (b) Neon crosses ~100 CU-hrs or 0.5 GB → Launch usage-based. Re-evaluate B if monthly infra spend > ~$25 and B features are still unused.
Gate 5 — **Performance budget (SEO):** LCP ≤ 2.5 s, TTFB ≤ ~200 ms on mobile 3G-class throttling for sampled URLs; 0 render-blocking JS except AdSense; no soft-404s. Check with PageSpeed/CrUX at 30 days.
Gate 6 — **Interactive-feature trigger:** if accounts/comments/membership become a committed requirement → run a 1-week spike on Supabase+Vercel before building it in; do not retrofit onto the A stack.
Gate 7 — **Region gate:** confirm Seoul-adjacent availability/latency for CF (yes, global), Neon (ap-northeast-2 seen on status page), Vercel functions (UNKNOWN — verify), Supabase (UNKNOWN — verify) once audience region is confirmed at Gate 0.

---

## 6. First 30-day plan (architecture workstream only; coordinate with content/topic pods)
- **D1–3:** Gate 0 decisions (topics, language, region). Define content schema (front-matter) and review workflow states. Freeze repo layout: `content/posts/*.md`, `public/`, `src/`, `scripts/`.
- **D4–8:** Scaffold static SSG + minimal theme (posts, index, tags, sitemap, RSS, robots, JSON-LD); local build < 30 s; Lighthouse pass ≥ ~90 (UNKNOWN until run).
- **D9–12:** Cloudflare Pages project + custom domain + preview deployments + rollback test; DNS verified; deploy hook wired to GitHub Actions.
- **D13–16:** Neon project (region per Gate 0) + schema for draft/review/publish state; migrations in repo; scale-to-zero verified; cost dashboard/alerts on.
- **D17–22:** Build the publish pipeline in GitHub Actions: merge-to-main → build → Pages deploy; draft branch flow with a human approval step (PR review); Neon status updates. **Manual publish remains possible** (git push) the whole time — automation must never be the only path.
- **D23–27:** AdSense-related readiness pass: legal pages (privacy, about, contact), policy self-review, HTML-source access check, Search Console property + sitemap submit; apply to AdSense (approval timeline UNKNOWN, typically days–weeks per practitioner reports — UNVERIFIED).
- **D28–30:** Run Gate 3–5 checks; write the week-4 review: real traffic/CrUX baseline, pipeline failure log, cost report, decision-gate scorecard; report to CEO/lead for the go/no-go on scaling topics.

---

## 7. Open questions (for the synthesis/CEO)
1. Audience language & region (Gate 0) — blocks region and AdSense-language decisions.
2. Are comments / newsletter / member areas committed roadmap items in year 1? (Strongest argument for B.)
3. Operator skill set: static/TS-edge comfort vs Next.js fluency (recommendation assumed A-comfort or willingness to learn).
4. Content cadence target (posts/week) and whether reviews are one human or a panel — drives pipeline shape and build quota.
5. Who holds Google (AdSense/SC) and domain accounts, and is a separate Gmail/entity needed for compliance?
6. Is the operator willing to pay $20–45/mo from month ~2 for B's conveniences, or is near-$0 the hard constraint? (This alone can decide A vs B.)
7. AdSense "readiness" threshold the business will use (post count, traffic, quality gates) — no public Google threshold exists; needs an internal definition.
8. Any existing assets: domain name, Google account, draft topics, or preferred stack? (Repo is empty; no evidence found.)

---

### Appendix — verification notes
- Cloudflare Workers limits (Free 100k req/day, 10 ms CPU, 5 cron triggers free / 250 paid; Paid from $5/mo, 10M req incl., +$0.30/M; Workers Logs 200k/day free 3-day retention; KV/R2/Queues pricing): developers.cloudflare.com/workers/platform/limits and /workers/platform/pricing — retrieved 2026-09.
- Cloudflare Pages limits (20k files, 500 builds/mo, 1 concurrent build free; functions billed as Workers): developers.cloudflare.com/pages/platform/limits — retrieved 2026-09.
- Neon plans (Free 0.5 GB, 100 CU-hrs, scale-to-zero 5 min, 1-day monitoring; Launch usage-only no min, $0.106/CU-hr, $0.35/GB-mo, 500 GB transfer then $0.10/GB; Scale $0.222/CU-hr; instant restore $0.20/GB-mo): neon.tech/pricing and docs/introduction/plans — retrieved 2026-09.
- Supabase pricing (Free 500 MB DB / read-only trigger, 1-week pause, 5 GB egress, 50k MAU; Pro $25/mo, 8 GB, Micro compute credit, 250 GB egress then $0.09/GB, 7-day backups; Edge Functions 500k incl. free/2M Pro): supabase.com/pricing and docs compute-add-ons ($10 Micro, 2-core shared, 1 GB) — retrieved 2026-09.
- Vercel (Hobby 100 GB transfer, 100 deployments/day, cron once/day on Hobby; Pro $20/mo with credit, 1 TB; overage $0.6/M invocations, ~$0.15/GB after credit): vercel.com/docs/limits, /docs/cron-jobs/usage-and-pricing, /pricing — retrieved 2026-09.
- GitHub Actions free minutes (2,000/mo private): docs.github.com — retrieved 2026-09.
- AdSense eligibility (own content, policies, 18+, HTML access): support.google.com/adsense/answer/9724 + 7299563 — retrieved 2026-09. Approval thresholds: **none published — UNKNOWN**.
- Status pages (operational overall at retrieval; CF regional maintenance items): cloudflarestatus.com, vercel-status.com, status.supabase.com, status.neon.tech.
- **UNKNOWN list:** AdSense approval threshold/timeline; AI-content policy stance as of launch; Vercel function Seoul region; Supabase Seoul region; Neon cold-start latency in production; Supabase PITR tier; exact per-pageview revenue expectations; Vercel/Supabase free-tier limits as of launch day (re-verify).
