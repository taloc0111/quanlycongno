// Tìm kiếm + lọc quyền cho trang Hướng dẫn (tách khỏi HelpApp.jsx để test riêng được).

/** Chữ thường, bỏ dấu tiếng Việt (đ → d) và dấu ** của chữ đậm — để "ve down" khớp "Vé down". */
export function normalize(s) {
  return String(s ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/\*\*/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Mọi chữ của 1 chủ đề (tiêu đề, tóm tắt, nội dung, từ khoá) — đã chuẩn hoá. */
export function topicText(topic) {
  const parts = [topic.title, topic.summary, ...(topic.keywords || [])];
  for (const b of topic.body || []) {
    if (b.text) parts.push(b.text);
    if (Array.isArray(b.items)) parts.push(...b.items);
  }
  return normalize(parts.join(' '));
}

/** Chủ đề người dùng được thấy: bỏ chủ đề cần role / tính năng mà họ không có. */
export function visibleTopics(topics, { role, hasFeature } = {}) {
  return topics.filter((t) => (!t.roles || t.roles.includes(role)) && (!t.feature || !!hasFeature?.(t.feature)));
}

/**
 * Tìm chủ đề chứa MỌI từ trong câu tìm (không phân biệt dấu). Khớp ở tiêu đề / từ khoá được xếp trước.
 * Câu tìm rỗng → trả về nguyên danh sách.
 */
export function searchTopics(topics, query) {
  const q = normalize(query);
  if (!q) return topics;
  const words = q.split(' ');
  const scored = [];
  topics.forEach((t, i) => {
    const hay = topicText(t);
    if (!words.every((w) => hay.includes(w))) return;
    const title = normalize(t.title);
    const keys = normalize((t.keywords || []).join(' | '));
    const score = title.includes(q) ? 3 : keys.includes(q) ? 2 : words.every((w) => title.includes(w)) ? 1 : 0;
    scored.push({ t, score, i });
  });
  return scored.sort((a, b) => b.score - a.score || a.i - b.i).map((x) => x.t);
}
