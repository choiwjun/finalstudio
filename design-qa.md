# Signal Archive v2 design QA

source visual truth:
- `/mnt/c/Users/wj941/OneDrive/바탕 화면/wj-blog-design-option-2.png`
- `/mnt/c/Users/wj941/OneDrive/바탕 화면/wj-blog-design-option-3.png`

implementation screenshot: unavailable
viewport: not captured; target is desktop 1440px plus 768px and 390px responsive checks
state: public home empty state, draft article, local admin dashboard
source dimensions: 1488 × 1058 PNG for both generated references
implementation dimensions: unavailable
density normalization: not applicable; implementation screenshot was not captured

## Comparison evidence

The selected direction is implemented from the two generated references: option 2 supplies the search-first reading queue and option 3 supplies the archive rhythm, neutral surface, and topic index. A rendered implementation screenshot could not be opened or captured in this environment.

Static evidence passed:

- `npm run check:content`
- `npm run check:prompts`
- `git diff --check`
- Windows `npm.cmd run build`
- Windows `npm.cmd run check:build`
- `node --check scripts/qa-cdp.mjs`

## Findings

- [P1] Visual comparison is blocked. The environment has no available Chrome/Chromium executable and Chrome DevTools port `9223` is unavailable, so the current implementation cannot be compared against the selected references at the same viewport.
  - Fix: run Chrome/Chromium with a reachable capture path, capture `/`, `/admin/preview/`, and `/admin/` at 1440px, 768px, and 390px, then repeat this report.

## Required follow-up checks

- Compare typography, wrapping, spacing rhythm, color tokens, featured image treatment, and Korean copy against both source references.
- Test the home search form, public navigation, topic links, draft preview navigation, admin search/filter controls, and modal controls.
- Check 390px for header wrapping, search controls, reading queue rows, article tables/code, and admin table overflow.
- Record any P0/P1/P2 findings, fix them, and capture the revised implementation before handoff.

final result: blocked
