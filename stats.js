// Pure helpers for ratings and stats (no DOM, no network).

/** Rating that counts: the re-rating if the review was resolved and re-rated. */
export const effRating = (r) => (r.resolved && r.rerating ? r.rerating : r.rating);

const avg = (nums) => (nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : null);

/** Newest first: by review date, then creation time. */
export const byNewest = (a, b) =>
  b.review_date.localeCompare(a.review_date) || String(b.created_at).localeCompare(String(a.created_at));

export function summarize(list) {
  return { count: list.length, avg: avg(list.map(effRating)) };
}

/** Count of reviews per star value, 5 → 1. */
export function distribution(list) {
  return [5, 4, 3, 2, 1].map((stars) => ({
    stars,
    count: list.filter((r) => effRating(r) === stars).length,
  }));
}

export function topicAverages(list) {
  const groups = new Map();
  for (const r of list) {
    if (!groups.has(r.topic)) groups.set(r.topic, []);
    groups.get(r.topic).push(effRating(r));
  }
  return [...groups]
    .map(([topic, ratings]) => ({ topic, avg: avg(ratings), count: ratings.length }))
    .sort((a, b) => b.avg - a.avg || b.count - a.count || a.topic.localeCompare(b.topic));
}

const monthKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

/** Average per month for the last `months` months, oldest first. avg is null for empty months. */
export function monthlyTrend(list, months = 12, now = new Date()) {
  const out = [];
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = monthKey(d);
    const ratings = list.filter((r) => r.review_date.slice(0, 7) === key).map(effRating);
    out.push({
      key,
      label: d.toLocaleDateString('en', { month: 'short' }),
      avg: avg(ratings),
      count: ratings.length,
    });
  }
  return out;
}

/** Highest and lowest rated review dated in the current month (null if none). */
export function bestWorstThisMonth(list, now = new Date()) {
  const key = monthKey(now);
  const month = list.filter((r) => r.review_date.slice(0, 7) === key).sort(byNewest);
  if (!month.length) return { best: null, worst: null };
  const best = month.reduce((a, b) => (effRating(b) > effRating(a) ? b : a));
  const worst = month.reduce((a, b) => (effRating(b) < effRating(a) ? b : a));
  return { best, worst: worst === best ? null : worst };
}

/** Consecutive 5-star reviews counting back from the most recent. */
export function fiveStarStreak(list) {
  let n = 0;
  for (const r of [...list].sort(byNewest)) {
    if (effRating(r) !== 5) break;
    n++;
  }
  return n;
}

/** CSV with a BOM so Excel opens Cyrillic correctly. */
export function toCSV(list, nameById) {
  const cols = [
    ['Date', (r) => r.review_date],
    ['From', (r) => nameById(r.author_id)],
    ['To', (r) => nameById(r.subject_id)],
    ['Topic', (r) => r.topic],
    ['Title', (r) => r.title],
    ['Rating', (r) => r.rating],
    ['Re-rating', (r) => r.rerating ?? ''],
    ['Tags', (r) => (r.tags || []).join('; ')],
    ['Comment', (r) => r.comment],
    ['Improvement promised', (r) => (r.promised ? 'yes' : 'no')],
    ['Resolved', (r) => (r.resolved ? 'yes' : 'no')],
    ['Reply', (r) => r.reply ?? ''],
    ['Reaction', (r) => r.reaction ?? ''],
  ];
  const cell = (v) => {
    const s = String(v ?? '');
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const rows = [cols.map(([h]) => h), ...[...list].sort(byNewest).map((r) => cols.map(([, f]) => f(r)))];
  return '﻿' + rows.map((row) => row.map(cell).join(',')).join('\r\n');
}
