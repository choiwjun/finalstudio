#!/usr/bin/env python3
"""실제 화면 스크린샷 캡처 — 본문 증거용. AI 일러스트 대체 금지.

  python3 scripts/capture-screenshot.py --url <URL> --out public/images/<name>.png \
      [--width 1440] [--height 900] [--wait-ms 2500] [--full] [--click "텍스트"]

캡처한 화면의 출처(URL)·시각·도구를 글 본문/provenance에 함께 기록한다.
"""
import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

from playwright.sync_api import sync_playwright


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--width", type=int, default=1440)
    parser.add_argument("--height", type=int, default=900)
    parser.add_argument("--wait-ms", type=int, default=2500)
    parser.add_argument("--full", action="store_true")
    parser.add_argument("--click", default=None)
    args = parser.parse_args()

    out = Path(args.out)
    if not str(out).endswith(".png"):
        print("출력은 .png 여야 합니다", file=sys.stderr)
        return 1
    out.parent.mkdir(parents=True, exist_ok=True)

    with sync_playwright() as pw:
        browser = pw.chromium.launch()
        page = browser.new_page(
            viewport={"width": args.width, "height": args.height},
            locale="ko-KR",
        )
        page.goto(args.url, wait_until="domcontentloaded", timeout=60_000)
        page.wait_for_timeout(args.wait_ms)
        if args.click:
            page.get_by_text(args.click, exact=False).first.click()
            page.wait_for_timeout(args.wait_ms)
        page.screenshot(path=str(out), full_page=args.full)
        browser.close()

    provenance = {
        "url": args.url,
        "capturedAt": datetime.now(timezone.utc).isoformat(),
        "tool": f"playwright-python chromium",
        "viewport": {"width": args.width, "height": args.height},
        "fullPage": args.full,
        "out": str(out),
    }
    print(json.dumps(provenance, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
