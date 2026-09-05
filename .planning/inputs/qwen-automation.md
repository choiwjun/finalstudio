# Automation, Editorial Operations, and Adversarial Review

Planning-pod input — role: automation pipeline + editorial ops + adversarial challenge.
Report date: 2026-09-04. Repo state at time of writing: empty except `.git` (single commit
`42e744a Initial commit`) and this `.planning/inputs/` directory. No code, config, content, or
credentials were created, changed, or used by this agent.

Confidence labels used throughout: **VERIFIED** = quoted from a primary source fetched in this
session (URL + fetch date given); **ASSUMPTION** = reasonable but untested; **UNKNOWN** = needs
evidence we do not have.

---

## 1. Findings

### 1.1 What Google actually says about automated content (VERIFIED)

Fetched 2026-09-04:

- **Spam policies — "Scaled content abuse"** — `https://developers.google.com/search/docs/essentials/spam-policies`
  > "Scaled content abuse is when many pages are generated for the primary purpose of manipulating
  > search rankings and not helping users... typically focused on creating large amounts of
  > unoriginal content that provides little to no value to users, **no matter how it's created**."
  Listed example: "Using generative AI tools or other similar tools to generate many pages **without
  adding value for users**."
  Same page also defines **Site reputation policy** (third-party content placed on a host mainly to
  ride its established ranking signals), **Expired domain abuse**, **Doorway abuse**, **Cloaking**,
  **User-generated spam**, and note that "Creating substantially similar pages that are closer to
  search results than a clearly defined, browseable hierarchy" is doorway-adjacent.
- **Guidance on using generative AI content** — `https://developers.google.com/search/docs/fundamentals/using-gen-ai-content` (last updated 2025-12-10)
  > "using generative AI tools or other similar tools to generate many pages without adding value
  > for users **may violate Google's spam policy on scaled content abuse**."
  It points to Quality Rater Guidelines §4.6.5 (scaled content abuse) and §4.6.6 (main content made
  with "little to no effort, little to no originality, little to no added value"). It also says
  accuracy/quality/relevance applies to **metadata too** — `<title>`, meta description, structured
  data, image alt text — and recommends **disclosing how content was created**.
- **AI-generated content blog post (2023-02-08)** — `https://developers.google.com/search/blog/2023/02/google-search-and-ai-content`
  > "Using automation—including AI—to generate content **with the primary purpose of manipulating
  > ranking** in search results is a violation of our spam policies... not all use of automation,
  > including AI generation, is spam."
- **Creating helpful, reliable, people-first content** — `https://developers.google.com/search/docs/fundamentals/creating-helpful-content`
  Explicit warning signs include: "Are you **producing lots of content on many different topics** in
  hopes that some of it might perform well?", "Are you using **extensive automation to produce
  content on many topics**?", "Are you mainly summarizing what others have to say without adding
  much value?", "Did you decide to enter some niche topic area **without any real expertise**, but
  mainly because you thought you'd get search traffic?", "writing to a particular word count
  (No, we don't)". Also: "does your site have a **primary purpose or focus**?"
- **Optimizing for generative AI features** — `https://developers.google.com/search/docs/fundamentals/ai-optimization-guide`
  Names the standard directly: **commodity vs non-commodity content**. Example of commodity:
  "7 Tips for First-Time Homebuyers". Example of non-commodity: "Why We Waived the Inspection &
  Saved Money: A Look Inside the Sewer Line". "Don't just recycle what others on the internet have
  already said, **or could easily be produced by a generative AI model**."
- **Indexing API is not a general publishing tool** — `https://developers.google.com/search/apis/indexing-api/v3/using-api`
  > "The Indexing API can **only** be used to crawl pages with either `JobPosting` or
  > `BroadcastEvent` embedded in a `VideoObject`." Also: "Our spam policies apply to content
  > submitted with the Indexing API" and "Don't circumvent our submission limits, such as by using
  > multiple accounts." Removal requires the URL to already return 404/410 or be `noindex`.
  Operational consequence: for a blog, discovery = sitemap submission via Search Console + normal
  crawl. **Indexing speed is not purchasable or automatable** here. **UNKNOWN:** exact crawl/index
  latency for a brand-new domain in this niche.

Implication: the pipeline's *quality gate*, not its *throughput*, is the thing that determines
whether this business exists in 12 months. "Automation is allowed" is true; "volume with no value
add is a spam policy" is also true, and the second one is the enforceable one.

### 1.2 AdSense-side reality (VERIFIED policy text; UNKNOWN enforcement)

- `AdSense Program policies`, `https://support.google.com/adsense/answer/48182?hl=en` (page footer:
  "Last updated: August 4, 2026"). Contents that bind this project:
  - "All publishers are required to adhere to the **Google Publisher Policies** and the following
    policies"; non-compliance → "disable ad serving to your site and/or **disable your AdSense
    account** at any time", and a disabled account is "not eligible for further participation".
  - Ad placement: may **not** place ads "on any **non-content-based page**", "on pages published
    specifically for the purpose of showing ads", in pop-ups, in emails, or so that "site content
    [is] difficult to distinguish from ads".
  - Traffic: no paid-to-click/click-exchange/autosurf; pages with Google ads must comply with
    **Landing Page Quality Guidelines**; "It is your responsibility to ensure that **no ad network
    or affiliate** uses such methods to direct traffic to pages that contain your AdSense code."
  - Invalid clicks: may not click your own ads "for any reason"; automated click/impression tools
    prohibited. Relevant to us because a bot-heavy internal pipeline must never touch live ad pages.
- **The famous "low value content" rejection reason is not a clause in the program-policy page.**
  **UNKNOWN / partially VERIFIED:** the exact current eligibility wording and the "valuable
  content" policy live in *Google Publisher Policies* / the content-policy and
  ad-traffic-quality pages, which we did **not** fetch (two support URLs returned 404 in this
  session; search-engine snippets only, not treated as authoritative). This must be read by the
  implementation pod before launch, not inferred from blog posts about rejection recovery.
- Enforcement thresholds — account minimum payout, review latency, traffic requirements, country
  eligibility, whether AdSense will even review a site under N pages — are all **UNKNOWN** here.
  Anyone quoting numbers for these is quoting folklore, not a fetched document.

### 1.3 Infrastructure evidence, and a correction to the framing

Fetched 2026-09-04. The brief's candidates (A) Cloudflare + Neon, (B) Supabase + Vercel are treated
below, but the load-bearing distinction is not vendor — it is **static-first vs database-first**.

**Cloudflare Pages** — `https://developers.cloudflare.com/pages/platform/limits/` (doc dated 2026-07-16), Free plan:
500 builds/month, 1 concurrent build, 20-minute build timeout · 100 custom domains/project ·
**20,000 files/site** on Free (100,000 on paid, needs `PAGES_WRANGLER_MAJOR_VERSION=4`) ·
25 MiB max file · unlimited *preview* deployments · 100 projects/account · `_redirects` 2,000
static + 100 dynamic · Functions bill against Workers quota (Standard usage model).

**Cloudflare Workers (Functions) Free** — `https://developers.cloudflare.com/workers/platform/limits/` (2026-09-03):
100,000 requests/day/account (error 1027 beyond) · **CPU time 10 ms** free / 5 min paid (default 30 s) ·
128 MB memory · 50 subrequests/request · **5 cron triggers per account** on Free (250 paid) ·
cron CPU: 10 ms free; paid 30 s (<1 h interval) / 15 min (≥1 h interval) · 1 Worker free, 100 paid ·
3 MB worker size free.

**Neon** plans — `https://neon.com/docs/introduction/plans`:
Free: no monthly cost, 100 projects, **100 CU-hours/project**, **0.5 GB storage/project**,
5 GB egress/project, autoscale to 2 CU (8 GB RAM), **scale-to-zero after 5 min**, 10 branches/project,
monitoring 1 day, **1 manual snapshot**, no instant restore, history window 6 h capped at 1 GB,
no spending notifications. Launch/Scale: $0.106 / $0.222 per CU-hour, $0.35/GB-month storage,
500 GB egress included then $0.10/GB, instant restore $0.20/GB-month, PITR 7 d / 30 d,
100 snapshots, spending notifications included.

**Supabase** — `https://supabase.com/pricing`:
Free: $0/mo, unlimited API requests, 50,000 MAU, **500 MB database**, shared CPU · 500 MB RAM,
5 GB egress + 5 GB cached egress, 1 GB file storage, **paused after 1 week of inactivity**,
**limit of 2 active projects**, no branching, **no automatic backups**, log retention 1 day,
Edge Functions 500,000 invocations, 200 realtime peak connections.
Pro: $25/mo (first project; extra projects from $10/mo), 100K MAU then $0.00325/MAU, 8 GB disk then
$0.125/GB, 250 GB egress then $0.09/GB, 100 GB file storage, daily backups 7-day retention,
7-day logs, branching $0.01344/branch-hour, custom PITR +$100/mo per 7 days.
Team: from $599/mo. `pg_cron` documented at `https://supabase.com/docs/guides/database/extensions/pg_cron`.

**Vercel** — `https://vercel.com/docs/plans/hobby` (2026-08-31) and `https://vercel.com/legal/terms`:
Hobby: free, **first 1,000,000 function invocations**, 4 CPU-hrs active / 360 GB-hr provisioned
memory, 5,000 image transformations, 1M edge requests, **100 deployments/day**, function max
duration **300 s**, build vCPUs 2 / 8 GB / 32 GB disk, 1 month of analytics data, 1 h runtime logs,
and — the important one — exceeding limits generally means **waiting until 30 days have passed**.
Terms §4 Hobby Plan: "You shall **only use the Services under a Hobby plan for your personal or
non-commercial use**... We **reserve the right to disable or remove any Project or website
deployment on the Hobby plan with or without notice** at our sole discretion."
Pro: from $20/user/month (per the upgrade copy quoted on that page), 10M edge requests included,
6,000 deployments/day, duration configurable to 800 s (1800 s beta).

**Corrections this forces on the framing:**

1. **Vercel Hobby is contractually non-commercial.** An AdSense-monetized site is commercial. The
   "$0 stack B" is therefore not legally available as-is; option B's floor is **$20/mo Vercel Pro**,
   not $0. Cloudflare Pages/Workers have no fetched non-commercial clause, but we did **not** fetch
   the Cloudflare AUP (404) — so "Cloudflare free tier permits a monetized blog" is **ASSUMPTION**,
   flagged for verification.
2. **Both "free" database tiers are wrong for this job in different ways.** Supabase Free pauses a
   project after 1 week of inactivity and caps you at 2 projects with **no backups** — a content
   backend whose editorial state can vanish while you are on holiday. Neon Free gives 0.5 GB
   (plenty for text) and 100 CU-h/project, which fits a low-write CMS, but scale-to-zero after 5 min
   means **first-request cold latency** on the admin path (magnitude: **UNKNOWN**).
3. **The blog should not depend on a database at all.** Markdown files in git, compiled to static
   HTML, make the whole content corpus: versioned, diffable, reviewable in a PR, restorable with
   `git revert`, portable to any host, and free to store. A database-backed CMS buys us *nothing*
   for a single-author publishing workflow and buys us *cost, pauses, migrations, and lock-in*.
4. Neither A nor B is a "hosting decision". They are two different **content-storage models**.
   Recommendation §2 separates them explicitly.
5. **Cost reality check.** At 1–5 pages/week (see §4), the correct free tier is the *static* one.
   Spend lands in: domain (~$10–15/yr, **UNKNOWN** current pricing), LLM/SEO tooling, and possibly
   one paid tier later. Total infrastructure can be $0–5/mo for year one on Cloudflare Pages
   (static, no Functions). **ASSUMPTION**, based on the fetched Pages/Workers limits above.

### 1.4 Editorial-ops findings specific to this repo

- Repo is empty. So every pipeline guarantee (protected branches, review gates, CI) is a **greenfield
  choice**, not a migration. This is the single cheapest moment to install a hard approval gate.
- `.planning/inputs/*` is inside the same repo root that would publish the site. Unless a
  `.gitignore`/deploy-filter decision is made, internal planning docs and adversarial notes are at
  risk of being built and published. Flagged in §5 risk R7.
- OneDrive path (`/mnt/c/.../OneDrive/바탕 화면/...`) is a Windows-mount, cloud-synced filesystem.
  Known hazards for a git repo: file-lock/sync races, line-ending churn, non-ASCII path segments,
  and slower `git`/node I/O under WSL. **ASSUMPTION** (not measured), but it is a real operational
  risk for automated commits and CI parity. Recommend the working clone live outside OneDrive.
- The repo has **no remote**. So today the entire content corpus = one laptop + OneDrive. That is a
  single point of failure for a business whose only asset is text.
- **Language/market is an unstated dependency that changes everything.** Korean vs English content
  changes: AdSense availability and RPM, Google policy surfaces (Korea has real AdSense gating
  history), SERP competition, and whether "10x content" is even reachable. **UNKNOWN** — must be
  answered in week 0. The Korean-language skill set available in this environment
  (`humanize-korean`) is a hint the intended market may be Korean, but we did not verify intent.

---

## 2. Recommendation

**R1 — Pipeline shape: git-native, static-first, human-gated. Automate everything up to the gate;
automate nothing past it.**

Stages and their ownership:

| # | Stage | Automatable? | Gate / artifact | Owner |
|---|---|---|---|---|
| 0 | Niche & entity research | Partly | `topics/<slug>/brief.md`: audience, search intent, our unique angle, monetizable query set | Human decides |
| 1 | Source gathering | Yes (fetch + store) | `sources/<id>.json` — URL, fetch date, quote, location | Tool |
| 2 | Outline | Yes | outline must contain a *first-hand* element (data we measured, thing we did, person we asked) or it is rejected | Human approves outline |
| 3 | Draft | Yes (LLM) | `drafts/<slug>.md` + model/prompt/version metadata in front matter | Tool |
| 4 | Mechanical QA | Yes, deterministic | CI check: broken links, orphan images, title/desc length, duplicate-title / near-duplicate n-gram check, reading level, template-similarity score, `alt` present, no lorem/tbd, sitemap & canonical consistency | Tool blocks |
| 5 | Fact & source check | **Assisted, human-decided** | every non-trivial claim carries a source id or is struck. Adversarial pass: separate model invocation asked to *falsify*, not to praise | Human signs |
| 6 | Editorial voice pass | No | human rewrites at least the intro, the conclusion, and every claim of experience | Human |
| 7 | SEO metadata | Yes, then human edits | title, description, canonical, OG, structured data — validated against Google's structured-data rules, not guessed | Human edits |
| 8 | Policy/compliance lint | Yes | no YMYL medical/financial claims without a qualified reviewer; disclosure line if AI-assisted; privacy + consent + contact/about pages present | Tool blocks |
| 9 | **Approval (hard gate)** | **No — mandatory human** | PR approval → merge. Only `main` deploys. No auto-merge on content PRs | Human |
| 10 | Schedule | Yes | publish date/time in front matter; scheduled job builds and deploys only already-merged posts | Tool |
| 11 | Publish | Yes (deploy on merge) | immutable deployment URL retained; deploy = new version, never in-place overwrite | Tool |
| 12 | Notify discovery | Yes | submit/update sitemap in Search Console; **no** Indexing API (not eligible — §1.1) | Tool |
| 13 | Monitor | Yes | Search Console query/page data, index coverage, Core Web Vitals, ad-serving status, revenue by page | Tool + weekly human read |
| 14 | Iterate or kill | Partly | refresh / consolidate / **delete** decision per post | Human |
| 15 | Rollback | Yes | one-command revert to previous deployment + `git revert`; content deleted = 410 + removed from sitemap | Tool |

**R2 — Where human review is *mandatory* (non-negotiable, six of them).**

1. **Topic admission** — the decision to publish at all in this topic area, and the claim of our
   unique angle. (Google's people-first list explicitly flags "lots of content on many topics" and
   "niche topic without real expertise".)
2. **Any factual claim that could harm or mislead** — money, health, law, security, immigration,
   tax, medicine, "best X for Y" where Y is a purchase decision. This is the YMYL set.
3. **Any first-person or experience claim** — "I tested", "we compared", "in my setup". If a human
   did not do it, the sentence is forbidden. This is the line between non-commodity and commodity
   content, and the line between disclosure-OK and deceptive.
4. **Numbers, dates, prices, versions** — every one is source-tagged or deleted, with fetch date.
5. **Author identity page** — who is named as author, with what credentials. Anonymous mass
   publishing is precisely what §1.1's guidance treats as untrustworthy.
6. **Pre-deploy merge approval** and **any post-hoc content deletion**. Automation may not be able
   to make content disappear or appear without a human clicking.

Everything else — collection, drafting assist, linting, metadata generation, scheduling, sitemap
resubmission, monitoring digests, rollback execution — should be automated.

**R3 — Cadence: quality-cleared throughput, not throughput.** Start at **2 posts/week ceiling per
topic area, 1 human-reviewed unit per day max**. Volume is a *result* of the gate holding, not a
goal that pressures the gate. Explicit anti-goal: no "100 articles in 30 days". The evidence in
§1.1 makes high-volume machine output the primary identified threat to the business goal.

**R4 — Infrastructure: static content in git (Cloudflare Pages free tier) + no database for
content.** Defer Supabase/Neon until a concrete need exists (comments, authenticated members,
search index, programmatic personalization). If a database later enters, prefer the one whose
backup/pause terms we can live with — Neon's 0.5 GB + snapshots over Supabase Free's
pause-after-1-week + no-backups, and pay for Pro the moment content becomes revenue-bearing.
This is an input to the lead's A-vs-B choice, not a claim that A wins: both A and B are viable
**if** the content corpus stays git-native.

**R5 — Two review models, adversarially separated.** The model that drafts must not be the model
(or the prompt) that judges. Draft → independent falsification pass with a *different* instruction
and, where cheap, a different model → human. Self-review by the generator is the leakage pattern
that makes a pipeline feel safe while producing nothing verified.

---

## 3. Alternatives considered

**On the pipeline**

- **Fully autonomous publishing (no human gate).** Rejected: directly maps onto the scaled-content
  and "extensive automation on many topics" signals (§1.1), forfeits the AdSense
  "valuable/original content" case at review time, and produces a rollback problem we cannot even
  attribute to a decision-maker. Fastest path to zero.
- **CMS-backed editorial suite (Supabase/Neon + admin UI).** Rejected for now: cost, pause
  semantics, backup gaps, and it removes PR-based review — our strongest free control — and makes
  rollback coarser. Revisit when ≥3 non-technical contributors exist.
- **Git-native static but with auto-merge and post-hoc human review.** Rejected: an approval gate
  that can be bypassed by the automation it gates is not a gate.
- **Managed platform (Ghost / WordPress.com / Medium) instead of this repo.** Not evaluated here —
  **UNKNOWN** to this pod, and worth putting to the lead as a genuine third option: it removes most
  of §1.3's infrastructure questions and the AdSense placement-control question, in exchange for
  less control.
- **Human writes, tools only research/format.** Viable floor, arguably the highest-quality option
  per unit effort; kept as the fallback if §5's volume/quality trade-off fails in month 1.

**On topic selection (adversarial — challenge these likely assumptions)**

- **A1. "Pick topics by search volume / keyword tool."** Weak. Volume-ranked topics are the exact
  set that generative models already answer well → commodity content (§1.1's own example). Also the
  set with the strongest incumbent competition. Select on *our demonstrable experience* first,
  volume second.
- **A2. "Three topic areas is a good number."** Questionable. Google's people-first list asks
  "does your site have a primary purpose or focus?" Three unrelated areas on a new domain reads as
  the "many different topics hoping something ranks" pattern. **Recommend: 1 primary + at most 1
  adjacent, for 90 days.** Three only if they share one underlying entity/expertise.
- **A3. "Low-competition long-tail is the safe entry."** Half-true. Long-tail queries are also the
  ones AI Overviews answer inline; and doorway abuse is defined around "pages created to rank for
  specific, similar search queries" that "funnel users". Long-tail page-farms are the named failure
  mode, not the workaround.
- **A4. "Trending news = traffic."** Rejected: requires speed we cannot guarantee without removing
  human review, plus §1.2's ad-suitability issues. Also matches the "writing about things simply
  because they seem trending" warning sign.
- **A5. "AdSense RPM should drive topic choice."** Dangerous as a *primary* filter: highest-RPM
  niches (finance, insurance, loans, health) are the highest-E-E-A-T-burden, most-YMYL, and the
  niches where Google's own examples of abuse ("sponsored reviews of payday loans", "best
  casinos") literally live. RPM-driven niches are where an unknown new publisher has the least
  standing. Choose a niche where we have *verifiable* first-hand experience and accept a lower RPM.
- **A6. "Hosting choice is a top-3 decision."** No. The 90-day failure mode is content quality and
  the approval gate, not vendor. Do not spend decision budget here beyond §2-R4.
- **A7. "Publishing to /blog on an existing domain inherits authority."** Only flagged: nothing
  here suggests we have an existing domain, but if the lead proposes one, §1.1's **site reputation
  policy** is exactly what governs that. Not applicable to a fresh standalone site; would be a
  real policy question otherwise.

---

## 4. Risks

| ID | Risk | Likelihood | Impact | Mitigation / trigger |
|---|---|---|---|---|
| R1 | **Scaled content abuse classification** — pipeline output volume outruns value-add; manual action or algorithmic demotion | High if cadence raised | Fatal (no organic traffic = no revenue) | Hard rate limit in CI (max N merged posts/week); template-similarity + duplicate-n-gram gate; every post needs a first-hand element; kill switch that halts auto-drafting when the human gate falls behind |
| R2 | **AdSense rejection: "low value content"**, or later account disable | High at first application (typical for new small sites) | Business-goal miss, weeks of delay | Do not apply until: ≥20 genuinely reviewed posts, complete About/Contact/Author/Privacy/Terms, real navigation, ≥1 niche with internal link depth; then apply and treat rejection as data. **UNKNOWN**: current criteria/threshold — read Publisher Policies first |
| R3 | **Human gate becomes the bottleneck, gets quietly relaxed** | Very high | Silent quality collapse → R1 | Instrument the queue: median age of un-reviewed drafts; if aging grows, cut *volume target*, never the gate. State this as a written rule now |
| R4 | Fabricated citations / stale facts / wrong numbers in drafts | High (LLM default) | Trust + legal + refund-grade harm in YMYL | Mandatory `source_id` per claim; fetch date stored; automated re-verification job on published posts; falsification pass (R5 note) |
| R5 | Self-confirming review (drafting model validates its own draft) | High without design | Pipeline looks safe, isn't | Separate prompts/models; periodic blind review by a zero-context reviewer |
| R6 | **Vendor ToS mismatch**: monetized site on Vercel Hobby (non-commercial clause, §1.3) or on any free tier with an AUP we haven't read | Medium | Deployment removed without notice | Budget Pro tier if Vercel is chosen; fetch and read Cloudflare AUP before committing (we could not — 404) |
| R7 | Planning/internal files get built and published (`.planning/inputs/*` is in the same tree as the future site) | Medium, and high on day 1 if site is scaffolded at repo root | Embarrassing, and reveals internal strategy | Decide early: `site/` subdir or `.planning` excluded from build/`public/`; CI check that fails on publishing files under `.planning` |
| R8 | **Single-copy content corpus** — no git remote, OneDrive-only working copy | Certain today | Total asset loss possible | Add a private remote in week 0; content is text, so git = cheap backup |
| R9 | **Platform dependence**: a future policy change (Search, AI Overviews answer-inline, ad policy) hits the entire distribution channel at once | Medium-high over 12 months | Revenue cliff | Own email/RSS audience from week 1; monitor Search Console impressions by *page type* so we see the drop in days, not quarters |
| R10 | Core Web Vitals / CLS regressions from ad injection; ad layout shift hurts both UX and rankings | Medium | Rank + revenue | Reserve fixed ad-slot dimensions; Lighthouse/CWV budget in CI; **never** let automation click or pre-render ads (invalid-click policy) |
| R11 | Cold-start latency (Neon/Supabase scale-to-zero) and free-tier pause (Supabase 1 week) surprise | Medium | Admin unusable; content-lock during a pause | Git-native content removes most exposure; if DB enters, disable scale-to-zero or accept paid tier |
| R12 | Unbounded LLM cost from an aggressive auto-draft loop | Medium | Bill shock | Per-week token budget in the scheduler; hard stop; Cloudflare cron-count limits force a sane design anyway |
| R13 | Multilingual/AI-translation content (Korean↔English) as a scale shortcut | Medium | Translation-obfuscation is a named scaled-content example | If a second language is wanted, real localization + human check, not machine translation |
| R14 | Metric illusion — tracking drafts produced instead of pages that earn | High if unchecked | Wrong decisions for months | Success metric = indexed pages with ≥1 impression in 30 days, then RPM/1k; never "articles written" |

---

## 5. Decision criteria

**For the pipeline (any option must satisfy 1–7):**
1. Deploy happens **only** from a human merge to a protected branch.
2. Every published claim is source-tagged with a fetch date, or absent.
3. Deterministic CI gates exist for links, duplicates, metadata, and template similarity — and they can *fail a merge*.
4. Rollback is one command, < 5 minutes, and tested before it is needed.
5. Rate limiting is enforced by the system, not by discipline.
6. The drafting path and the judging path are separate invocations.
7. Internal planning files are provably excluded from what gets published.

**For infrastructure (A vs B):**
1. **Does the content corpus survive the vendor being removed?** (Static + git = yes.)
2. Cost at the *actual* cadence (2–8 posts/wk, low traffic year 1) — not cost at theoretical scale.
3. Commercial-use terms of the free tier we intend to live on for 12 months.
4. Backup/restore and pause semantics for the editorial store.
5. Build-time ceiling for a site with thousands of pages (Pages: 20 min, 500 builds/mo — fine; Vercel: 100 deployments/day Hobby — fine).
6. Cron/scheduler capacity: CF Free = 5 cron triggers/account (tight but workable for 1 pipeline); Supabase `pg_cron` available.
7. Lock-in of *content* vs lock-in of *plumbing*. Plumbing may be replaced in an afternoon; content must never be hostage.
8. Later non-negotiables if real traffic arrives: image handling, edge caching, and search-indexing needs.

**For topic selection (score each candidate 1–5 on all five; publish only if the first three are ≥4):**
1. **Demonstrable first-hand experience** we can prove on the page (defensible E-E-A-T).
2. **Non-commodity angle** — could a generic model write this page as well? If yes, reject.
3. **Answerability** — does the query have a real, checkable answer we can beat on?
4. Sustainable query surface (enough related intents to build a *browseable hierarchy*, not a doorway fan).
5. Ad-suitability and RPM — a tiebreaker only, never a selector (see A5).
6. Durability: still true and still searched in 3 years.

---

## 6. First 30-day plan (automation / editorial ops / adversarial)

Deliverables are decisions and controls, not content volume. No code is written by this pod.

**Days 1–3 — Set the constraints before anything is built.**
- Answer the market question: language + country + one audience persona. (Unblocks §1.4 and R2.)
- Apply the §5 topic scorecard to candidate areas; converge to **1 primary + 1 adjacent**, not 3 (A2).
- Decide content-storage model (recommend R4: git-native static) so the hosting debate is scoped.
- Move the working clone off OneDrive; add a private git remote (R8).
- Decide the build/publish boundary vs `.planning/` (R7).
- Output: signed topic brief; storage decision; cadence ceiling written down.

**Days 4–7 — Define the contract of a "post".**
- Front-matter schema: title, description, canonical, author + author-credential ref, publish date,
  topic, `source_ids[]`, AI-assistance disclosure flag, ad-suitability flag, review status.
- Claim/source format (`sources/<id>.json`) with fetch date and exact quote.
- Written "mandatory human review" list (§2-R2) as a checklist, in the repo, versioned.
- **Adversarial pass #1** on the schema itself: can a lazy draft satisfy every field without adding value? If yes, the schema is decorative — fix the field, not the intent.

**Days 8–14 — Build the gate before the generator.**
- CI checks first: broken links, duplicate/near-duplicate detection, title/description length,
  alt text, sitemap consistency, cadence rate limit, 404/410 policy, structured-data validity.
- Protected branch + required human approval on content PRs. No auto-merge path exists.
- Rollback drill: publish a canary post to a preview URL, break it, revert, confirm the previous
  deployment is live again. Time it. If rollback takes > 5 min, fix rollback before anything else.

**Days 15–21 — First cohort, manually paced.**
- 5–10 posts through the *full* pipeline, 2/week ceiling, human review on all six mandatory points.
- Every post must contain one thing a generic model could not write (own measurement, own setup,
  own photo, own interview).
- **Adversarial pass #2** (blind, zero-context reviewer, no knowledge of how the post was made):
  does it read machine-made? would you trust the numbers? is anything unverifiable? Publish only
  after this pass is clean, and record the failure modes found.

**Days 22–30 — Instrument, then decide automation depth.**
- Search Console property + sitemap submission; GA4/analytics decision; baseline capture.
- Monitoring job: index coverage, query impressions by page, CWV, link rot, weekly re-verification
  of numeric claims.
- Queue-health metric: median days a draft sits un-reviewed (R3 tripwire).
- **Decision gate at day 30:** raise cadence only if (a) blind-review pass rate is clean, (b) drafts
  are not aging in the queue, (c) ≥1 post has earned an impression. Otherwise hold cadence.
- AdSense application is **not** on this list — recommend deferring to ~day 60–90 with ≥20 reviewed
  posts (R2), pending the actual policy read.
- **Adversarial pass #3** on the whole plan: re-score the assumption that this business works via
  AdSense at all, given AI Overviews absorbing informational clicks. Output a written kill-criterion
  list: the specific observations that should make us stop or pivot.

---

## 7. Open questions (for the lead / human)

1. **Language and geography** of the content and the target audience? Korea-first, English, or both?
   This changes AdSense eligibility, RPM expectations, and the competitive set. (Highest priority.)
2. What **first-hand experience, data, access, or authority** does the human actually have? Name the
   domains where we could beat a generic model honestly. Without this, §1.1's evidence says the whole
   strategy is a coin flip.
3. How much **human review time per week** is realistically available (not aspirational)? The gate's
   capacity *is* the publishing budget. Say the number, and I will size the cadence to it.
4. Is there an **existing domain, brand, authorship identity, or Search Console property**? (Affects
   site-reputation-policy exposure and the cold-start plan.)
5. **Budget ceiling** for infra + LLM tooling per month, and is `Pro` tier acceptable when the ToS
   requires it (Vercel Hobby is non-commercial)?
6. Willingness to put a **real author name and face** on content, and to disclose AI assistance
   (Google's own guidance invites this, §1.1)? Anonymous + undisclosed is the weakest posture.
7. **AdSense application timing** preference: early (learn the rejection reason) vs after 20+ posts
   (better case)? We lack the current eligibility text — **UNKNOWN** — and someone must read the
   Google Publisher Policies page properly.
8. YMYL appetite: will we publish finance/health/legal-adjacent content for the RPM, accepting that a
   qualified human reviewer is then mandatory per §2-R2?
9. What is the **stop condition**? Revenue at month 6? Impressions at month 3? Without a written
   kill-criterion the pipeline will keep producing output long after it stopped being a business.
10. Single maintainer or multiple contributors? Determines whether a CMS (Supabase/Neon) ever earns
    its complexity back.
11. Where does **image/media** come from? Generated images need metadata and disclosure; scraped
    images are a copyright and scaled-content exposure (and legal-removal demotion is on the spam
    policy page).
12. Is the OneDrive/WSL setup permanent? If yes, we should test git + CI parity there explicitly
    before automation writes commits.

---

## Appendix A — Source log

All fetched by this pod on **2026-09-04** unless noted. HTTP 200 = content quoted above.

| Key | URL | Status |
|---|---|---|
| Google spam policies | https://developers.google.com/search/docs/essentials/spam-policies | 200 |
| People-first content | https://developers.google.com/search/docs/fundamentals/creating-helpful-content | 200 |
| AI-generated content (blog, 2023-02-08) | https://developers.google.com/search/blog/2023/02/google-search-and-ai-content | 200 |
| Using generative AI content | https://developers.google.com/search/docs/fundamentals/using-gen-ai-content | 200 |
| Optimizing for generative AI features | https://developers.google.com/search/docs/fundamentals/ai-optimization-guide | 200 |
| Indexing API — using the API | https://developers.google.com/search/apis/indexing-api/v3/using-api | 200 |
| Build a sitemap | https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap | 200 |
| AdSense Program policies | https://support.google.com/adsense/answer/48182?hl=en | 200 (dated 2026-08-04) |
| Cloudflare Pages limits | https://developers.cloudflare.com/pages/platform/limits/ | 200 (2026-07-16) |
| Cloudflare Workers limits | https://developers.cloudflare.com/workers/platform/limits/ | 200 (2026-09-03) |
| Cloudflare Workers cron triggers | https://developers.cloudflare.com/workers/configuration/cron-triggers/ | 200 |
| Neon plans | https://neon.com/docs/introduction/plans | 200 |
| Supabase pricing | https://supabase.com/pricing | 200 |
| Supabase pg_cron | https://supabase.com/docs/guides/database/extensions/pg_cron | 200 |
| Vercel Hobby plan | https://vercel.com/docs/plans/hobby | 200 (2026-08-31) |
| Vercel ToS §4 Hobby | https://vercel.com/legal/terms | 200 |
| Vercel function duration | https://vercel.com/docs/functions/configuring-functions/duration | 200 |

**Fetch failures / gaps (treat related statements as UNKNOWN):** AdSense Publisher Policies and
content-quality pages (`answer/1222795`, `answer/1348656`, `answer/10720012`, `answer/13553152`,
`answer/7836784` → 404 through this route); Neon legacy `plan-limits` path (moved); Supabase
`scale-to-zero` and `cron-jobs` doc paths (404); Cloudflare acceptable-use policy page (404 —
the free-tier commercial-use question is therefore **unverified**); Google "site reputation abuse"
naming differs across versions (current page uses "site reputation policy").
Web-search API (Serper) was **not configured** in this session, so no third-party corroboration was
attempted; everything above is primary-source or explicitly labelled.

## Appendix B — Assumption register (top 8)

1. A git-hosted static blog is cheaper and safer than a DB-backed CMS for one author. (Assumed true; untested here.)
2. 2 posts/week/area is sustainable for one human reviewer. (Unmeasured — R3 will show it.)
3. Cloudflare free tier permits a monetized personal blog. **UNVERIFIED** (AUP not fetched).
4. Vercel Pro at $20/user/month is the minimum legal floor for option B. (Based on fetched Hobby/upgrade copy; current price list **UNKNOWN**.)
5. A new domain can reach Google/AdSense traction within 6–12 months. (Industry folklore; no source.)
6. Neon/Supabase free tiers suffice for a CMS-like editorial store. (Numbers fetched; sufficiency for *our* write pattern **UNKNOWN**.)
7. AdSense remains a viable monetization channel under AI Overviews for the next 24 months. (Directional concern, **UNKNOWN**.)
8. Korean-language tooling in this environment implies a Korean-language site. **GUESS** — ask question 1.
