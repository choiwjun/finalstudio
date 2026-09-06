/**
 * 자동 생성 글의 추가 사람 검토 대상 탐지.
 *
 * 이 검사는 발행을 자동 승인하지 않는다. 위험 신호가 있는 글은
 * `manualReview: required`로 남겨 사람이 확인한 뒤 `approved`로 바꿔야 한다.
 */
export const CONTENT_RISK_RULES = [
  {
    id: 'finance',
    label: '금융·투자',
    patterns: [/투자/, /주식/, /코인/, /비트코인/, /가상화폐/, /암호화폐/, /대출/, /수익 보장/, /재테크/, /세금/],
  },
  {
    id: 'medical',
    label: '의료·건강',
    patterns: [/의료/, /질병/, /진단/, /치료/, /복용/, /약물/, /부작용/, /건강기능식품/],
  },
  {
    id: 'legal',
    label: '법률·분쟁',
    patterns: [/법률/, /불법/, /위법/, /소송/, /고소/, /처벌/, /벌금/, /징역/, /기소/],
  },
  {
    id: 'sensitive-claims',
    label: '피해·논란 주장',
    patterns: [/사기/, /피해/, /비리/, /내부고발/, /수익을 보장/, /무조건 오른다/],
  },
];

/**
 * 제목·설명·본문에서 위험 범주를 한 번씩만 반환한다.
 * @param {string} text
 * @returns {Array<{id: string, label: string, matched: string}>}
 */
export const detectContentRisks = (text) => {
  const haystack = String(text ?? '');
  return CONTENT_RISK_RULES.flatMap((rule) => {
    const match = rule.patterns.find((pattern) => pattern.test(haystack));
    return match ? [{ id: rule.id, label: rule.label, matched: match.source.replace(/^\\b|\\b$/g, '') }] : [];
  });
};
