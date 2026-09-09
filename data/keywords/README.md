# WJ keyword data

This directory contains the keyword-system boundary data used by the WJ blog.

`seeds.json` is a human-maintained input file with schema version `1`:

- `version` is `1`.
- `inputs` contains one or more objects with a lowercase kebab-case `category` and a non-empty `seeds` array.
- The initial categories are `ai-it`, `economy`, and `health`; additional categories must remain lowercase kebab-case.
- `title`, `description`, and explicit `intent` are optional. Intent must be one of `방법`, `개념`, `비교`, `문제 해결`, or `최신 이슈`.

Keyword candidates and records are evidence-led. A successful API response with a non-empty, shape-valid body is required before a record can become `ready-to-write`; empty, malformed, and failed responses remain unavailable evidence. Trend `ratio` values are relative values within one request and must not be stored as absolute search volume or converted into a score.

Raw evidence belongs under `data/keywords/raw/` and must not contain request headers, credentials, or secrets. Records use the eleven-field WJ contract:

```text
category, head_keyword, related_keywords, search_intent, content_angle,
source, collected_at, freshness, risk_flags, evidence_available, status
```

The status values are `candidate`, `researching`, `ready-to-write`, `written`, and `rejected`. `written` is a human handoff state; this directory does not trigger or modify the existing auto-publish pipeline.
