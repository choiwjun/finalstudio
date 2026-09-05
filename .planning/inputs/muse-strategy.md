# Blog Product & Content Strategy — AdSense Monetization
**Role:** product and content strategy (planning-pod specialist)
**Date:** 2026-09-04 | **Repo state:** empty, greenfield | **Goal:** Google AdSense approval → sustainable traffic revenue
**Constraint:** No code/config/publishing in this phase. Evidence-first; assumptions labeled.

> Tooling note: web search (Serper) was not configured in this session, so live SERP/CPC verification was not possible. Policy claims below are drawn from long-standing Google/AdSense/Search public documentation from memory and **must be spot-verified** against official docs before build (links listed in §8). Nothing here asserts a live ranking, CPC, or approval outcome.

---

## 1. Findings

### 1.1 AdSense reality for a new automated blog
- **Approval is editorial, not infrastructural.** AdSense (whether on Cloudflare+Neon or Supabase+Vercel) cares about: original valuable content, sufficient volume, clear navigation, About/Contact/Privacy pages, policy-compliant content, owned domain, and clean traffic. Infra choice does not meaningfully change approval odds. (Verify: AdSense eligibility / site approval checklist.)
- **Typical approval bar (heuristic, not official quota):** ~20–30 substantial original posts, each genuinely useful standalone, plus legal/about pages, no broken scaffolding, no password-walled main content. Thin 300-word AI summaries consistently fail or earn "low value content" rejections.
- **Automation is allowed; scaled thin content is not.** Google Search's *scaled content abuse* (spam policies) and the *helpful content* guidance penalize mass-produced pages with little original value — even if "human-reviewed" superficially. An automated pipeline must add verifiable original value (testing, screenshots, templates, data) per article, not just paraphrase.
- **Revenue math is sobering.** New informational blogs typically earn low RPMs until they have search trust + commercial-adjacent intent. Expect months of near-zero revenue. The business goal should be framed as: *months 1–3 = approval + search fit; months 4–12 = compounding evergreen library.* Anyone promising fast AdSense income from an empty auto-blog is unreliable.
- **Policy-risky categories can kill the account, not just a page.** Avoid: copyrighted text/images, scraped or spun content, deceptive claims, adult, gambling, hacked/crack content, misinformation, dangerous instructions, and invalid-click encouragement. YMYL (health, finance, legal) is not banned, but demands real expertise (E-E-A-T) a new automated blog cannot credibly supply — a strategic liability, not just an SEO difficulty.

### 1.2 What makes a topic durable for AdSense + automation
A topic must score on five axes simultaneously:
1. **Advertiser safety** — brands will bid next to it (software, education, productivity, consumer tech, home/office).
2. **Evergreen + refreshable** — questions people ask every year (how-to, templates, comparisons), not news spikes.
3. **Automation leverage** — structure is repeatable (steps, screenshots, checklists, templates) without fabricating facts.
4. **Provable moat** — a new blog can add something incumbents don't: fresh screenshots, version-tested steps, downloadable templates, Korean-localized specifics.
5. **Low E-E-A-T cost** — correctness can be verified by doing, not by credential (contrast: medical/financial advice needs licensed authority).

### 1.3 Topic candidates evaluated

| # | Candidate | Search intent | AdSense fit | Moat potential | Automation fit | Verdict |
|---|-----------|---------------|-------------|----------------|----------------|---------|
| T1 | **Practical software how-tos** (Sheets/Excel, Notion, Google Workspace, Windows/iPhone basics) | Strong how-to / problem-solving ("엑셀 중복 제거", "notion calendar sync") | High — SaaS, education, hardware advertisers; brand-safe | Medium-high via fresh screenshots, version stamps, templates | High — repeatable format, verifiable by execution | **RECOMMENDED pillar** |
| T2 | **Verified AI-workflow guides** (office/student use: summarize, draft, sheet formulas, meeting notes) | How-to + tool selection | High — AI SaaS competition bids aggressively | Medium — decays fast; moat only if every guide is hands-tested with prompts + outputs | Medium — automatable draft, but requires human-run test step | **RECOMMENDED adjacent (capped)** |
| T3 | **Everyday consumer explainers** (subscriptions, delivery/shopping, utilities, telecom plans) | Compare / save-money | Medium-high CPC potential, highly seasonal/promo-driven | Low-medium — facts change often; incumbents + official pages dominate | Low-medium — high update burden, price errors = trust loss | **Reserve / phase 2** |
| T4 | Personal finance / investing | High commercial intent | Highest CPC but **YMYL** | Very low for new anonymous blog | Low — advice liability, needs credentials | **REJECT as pillar** (occasional literacy basics only, no advice) |
| T5 | Health / diet / medical | Huge volume | Restricted demand + policy scrutiny, YMYL | ~Zero without experts | Dangerous to automate | **REJECT** |
| T6 | General tech news / gadget rumors | News intent, spikes | Low dwell, low evergreen value | Zero — rewrite of press releases | High volume but thin-duplicate trap | **REJECT** |
| T7 | Coding tutorials (beginner web dev) | Strong evergreen | Medium (dev tools, courses) | Low — saturated by MDN/freeCodeCamp/YouTube | Medium | **REJECT for v0** (revisit only if team has real dev identity) |

**Language assumption (flagged):** file paths suggest a Korean operator. T1–T2 work in Korean (`IT 활용팁`, `업무 자동화`) with lower competition than English and adequate Korean ad demand, at the cost of lower CPC than EN. Decision needed (see §7 Q1). This report assumes **Korean-first, with English slugs/SEO hygiene** unless the CEO decides EN-first.

---

## 2. Recommendation: 1 core + 1 capped adjacent

**Pillar (70% of output): T1 — "따라 하면 되는" practical software how-tos.**
- Scope: spreadsheet tasks, document formatting, Notion/Calendar/Gmail workflows, Windows + iPhone essentials, PDF/screenshot basics.
- Why: evergreen questions, screenshot-verifiable, brand-safe, maps cleanly to an automated template (problem → steps with screenshots → template/download → troubleshooting → version note).
- Editorial promise: *every guide tested on a stated version/date; every step has a screenshot or file; every post states what changed since last update.*

**Adjacent (30%, capped): T2 — hands-tested AI office workflows.**
- Scope: narrow job-to-be-done prompts (e.g., "회의록 → 액션아이템 정리", "긴 PDF 요약 후 표로"), each with the exact prompt, model/version, real input/output excerpt, and failure modes.
- Cap exists because AI-tool content rots fast and duplicates fastest. No generic "ChatGPT란?" explainers; only tested recipes.

**Explicit non-goals for v0:** finance advice, health, news rewrites, coupon/price-chasing posts, mass programmatic location/keyword pages.

### Content moat (how a new blog earns links and return visits)
1. **Fresh evidence per post:** current-version screenshots, explicit test date/version stamp, real files or templates.
2. **Troubleshooting depth:** the "안 될 때" section (3–5 failure cases with fixes) — this is what forums rank for and AI paraphrases skip.
3. **Templates & checklists:** downloadable Sheets/Notion templates or copy-paste checklists; hosted on the blog, not external drives.
4. **Update discipline:** quarterly re-test of top 20% posts with visible changelog ("2026-09 테스트: 메뉴 경로 변경 반영").
5. **Korean-localized specifics:** Korean UI labels, Korean keyboard shortcuts, domestic app variants — global English competitors don't cover these.

### Editorial boundaries (hard rules for the pipeline)
- **No advice in YMYL zones:** no diagnoses, dosages, investment picks, loan/tax directives. Everyday explainers may inform ("이런 제도가 있다") but never prescribe ("이 약을 먹어라 / 이 주식을 사라").
- **No fabricated testing:** if a step wasn't executed, the post doesn't claim it was. No stock "screenshots" passed off as real.
- **One question, one answer:** each post targets a single search task; no keyword-stuffed mega-posts, no near-duplicate variants ("엑셀 중복제거 1/2/3").
- **Attribution:** any third-party image, quote, or data gets source + license check; default to self-made screenshots.
- **Disclosure:** AI-assisted drafting disclosed on About/Editorial policy page; affiliate links (if any later) labeled per post. Never mix undisclosed affiliate pressure into "best tool" rankings.
- **Length floor with substance:** minimum useful length (~1,200–2,000 Korean words or equivalent depth) is a *consequence* of covering steps + failures, never padding.

### Avoiding thin / duplicative / policy-risky output
- **Pre-publish duplicate check:** exact-match title + outline search against existing index; reject if cosine-similar to an existing post or a top-ranking page without a differentiated section.
- **Value-add checklist (all must pass):** (a) tested steps, (b) original screenshot/file, (c) troubleshooting, (d) version/date stamp. Missing any = draft, not publish.
- **Scaled-content guardrails:** daily publish cap (e.g., ≤1/day in month 1), human sign-off required, update-to-new ratio tracked (target ≥1 update per 3 new posts by month 3).
- **Policy pre-screen:** blocklist (crack, torrent, gambling, adult, personal data, copyrighted dumps), plus YMYL classifier routing finance/health drafts to reject-by-default.

---

## 3. Alternatives considered

- **Alt A — T1 only (pure how-to library).** Pros: simplest QA, strongest evergreen compounding. Cons: slower early growth, vulnerable to YouTube/shorts for visual tasks. *Choose if editorial capacity is thin.*
- **Alt B — T1 + T3 (how-tos + consumer saving explainers).** Pros: broader keyword surface, seasonal traffic spikes. Cons: high fact-refresh cost, price-error trust risk, weaker automation fit. *Defer to phase 2 after pipeline discipline is proven.*
- **Alt C — English-first dev/AI blog.** Pros: higher CPC ceiling, global audience. Cons: brutal competition (MDN, official docs, established creators), native-level quality bar, slower approval trust. *Only if the team commits a real expert persona + original code/data per post.*

---

## 4. Risks

| Risk | Likelihood / Impact | Mitigation |
|------|---------------------|------------|
| AdSense "low value content" rejection due to AI-templated sameness | High / High | Value-add checklist, publish cap, human review, templates+screenshots as differentiators |
| Google scaled-content / spam manual action | Medium / Very high | ≤1 post/day early, no programmatic keyword pages, update ratio, Search Console monitoring |
| Topic rot (UI changes, AI model updates invalidate guides) | High / Medium | Version stamps, quarterly re-test queue, changelog; cap T2 at 30% |
| Zero revenue for months despite effort | High / Medium (morale) | Set expectation explicitly; track leading metrics (impressions, CTR, return rate), not just revenue |
| Copyrighted images / scraped text in pipeline | Medium / High | Self-made media by default; license check gate; no bulk image scraping |
| Invalid traffic / self-click temptation | Low / Fatal | Never click own ads, no traffic schemes; disclose to all contributors |
| Privacy compliance gap (KO PIPA + GDPR if EN readers) | Medium / Medium | Privacy/cookie policy before AdSense application; consent handling in infra track |

---

## 5. Decision criteria (for CEO synthesis)

Choose/keep a topic only if it passes **all six**:
1. Can a non-credentialed editor verify correctness *by doing* (not by authority)?
2. Can every post carry fresh evidence (screenshot/file/test) competitors lack?
3. Is the question asked year-round (not a news spike)?
4. Is it brand-safe for mainstream advertisers?
5. Is the refresh cost bounded (quarterly re-test feasible)?
6. Does it avoid YMYL advice and copyrighted dependence?

Kill/suspend rule: any topic with 2 consecutive quarters of declining impressions-per-post *and* rising refresh cost gets frozen; effort reallocates to the winner.

---

## 6. First 30-day plan (content track; no build)

- **Week 1 — Positioning & gates.** Lock KO-first vs EN-first; define author persona (individual vs team brand); write 1-page editorial policy + AI-use disclosure; finalize post template and value-add checklist; set up Search Console + Analytics accounts (no ads yet).
- **Week 2 — Pilot batch (5 posts, T1 only).** Manually produce 5 pillar how-tos end-to-end using the template (real screenshots, troubleshooting, version stamps). These become the gold-standard examples the future pipeline must match. Submit sitemap; observe indexing, not revenue.
- **Week 3 — Adjacent test (3 posts, T2) + QA calibration.** Publish 3 hands-tested AI recipes. Run duplicate/policy pre-screen on all 8; record review time per post (baselines automation ROI). Draft About/Contact/Privacy/Editorial pages.
- **Week 4 — AdSense readiness review.** Library at ~10–12 substantive posts + legal pages. Self-audit against decision criteria (§5) and low-value checklist. **Apply for AdSense only if** all posts pass the value-add gate and navigation/legal pages are live. Otherwise, add 10 more posts before applying. Plan months 2–3 cadence: ~2–3 posts/week, 1 update per 3 new.

Success metrics (30 days): 10+ published posts passing the checklist, 0 policy flags, indexed pages growing in Search Console, baseline review-time measured. *Revenue is explicitly not a 30-day metric.*

---

## 7. Open questions (need CEO / sibling-pod input)

1. **Language & market:** Korean-first vs English-first? (Affects CPC, competition, persona.) **Default assumption: KO-first.**
2. **Author identity:** real-name expert, team brand, or pseudonymous editor? (Affects trust, E-E-A-T, disclosure wording.)
3. **Volume vs quality:** is the CEO willing to hold ≤1 post/day and delay AdSense application until quality bar is met?
4. **Media production:** who captures screenshots/builds templates in the automated pipeline — human step or sandboxed runner? (Infra + ops pods.)
5. **Monetization beyond AdSense:** are affiliates/sponsorships in scope later, or AdSense-only? (Changes "best tool" editorial rules.)
6. **UNKNOWNs requiring verification:** live keyword difficulty/CPC for T1–T2 (needs keyword tool); official AdSense/Spam policy deltas since training cutoff (needs doc re-check in §8).

---

## 8. Policy sources to verify (official, before build)

- Google AdSense *Site approval / Eligibility* and *Content policies* (support.google.com/adsense)
- Google Search *Spam policies → Scaled content abuse* (developers.google.com/search/docs/essentials/spam-policies)
- Google Search *Helpful content / Creating helpful content* guidance
- Google AdSense *Invalid traffic* policy
- (If EN/EU readers) GDPR/cookie consent expectations; (if KO) PIPA privacy notice requirements — via infra/legal track

---

*Prepared by product & content strategy pod. No code, config, or publishing performed. All competition/CPC claims are structural judgments pending live verification; policy claims cite public Google documentation from memory and require re-check at build time.*
