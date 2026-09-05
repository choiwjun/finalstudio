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

export function topicLabel(topic: string): string {
  return topicLabels[topic] ?? topic;
}

export function topicBadgeClass(topic: string): string {
  return topic === 'ai-workflows' ? 'badge badge--ai' : 'badge badge--prod';
}
