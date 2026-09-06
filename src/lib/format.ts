const koDateFormatter = new Intl.DateTimeFormat('ko-KR', {
  year: 'numeric',
  month: 'long',
  day: 'numeric',
});

/** 2026년 9월 4일 형식 (DESIGN_SYSTEM 타이포 규칙 6). */
export function formatKoDate(date: Date): string {
  return koDateFormatter.format(date);
}

export function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

const topicLabels: Record<string, string> = {
  productivity: '업무도구 실전',
  'ai-workflows': 'AI 업무 활용',
};

const sourceCatalog: Record<string, { label: string; url: string }> = {
  'microsoft-excel-paste-options': {
    label: 'Microsoft Excel 붙여넣기 옵션',
    url: 'https://support.microsoft.com/en-us/excel/paste-options',
  },
  'microsoft-excel-vlookup': {
    label: 'Microsoft VLOOKUP 함수',
    url: 'https://support.microsoft.com/ko-kr/excel/functions/vlookup-function',
  },
};

export function topicLabel(topic: string): string {
  return topicLabels[topic] ?? topic;
}

export function topicBadgeClass(topic: string): string {
  return topic === 'ai-workflows' ? 'badge badge--ai' : 'badge badge--topic';
}

export function categoryPath(topic: string): string {
  return `/categories/${encodeURIComponent(topic)}`;
}

export function sourceMeta(sourceId: string): { label: string; url?: string } {
  return sourceCatalog[sourceId] ?? { label: sourceId };
}

export function difficultyLabel(difficulty?: string): string | undefined {
  if (!difficulty) return undefined;
  return difficulty;
}
