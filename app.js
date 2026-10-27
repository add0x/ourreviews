import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { SUPABASE_URL, SUPABASE_KEY, EMAIL_DOMAIN } from './config.js';
import {
  effRating, byNewest, summarize, distribution, topicAverages,
  monthlyTrend, bestWorstThisMonth, fiveStarStreak, toCSV,
} from './stats.js';

// ---------- Constants ----------
const TOPICS = ['Cooking', 'Dates', 'Listening', 'Chores', 'Gifts', 'Cuddles', 'Humor', 'Planning', 'Communication', 'Surprises'];
const TAGS = ['Above and beyond', 'Surprise win', 'Needs work'];
const REACTIONS = ['❤️', '😂', '😅', '🙏', '😢', '🔥', '🙄'];

const app = document.getElementById('app');
const configured = !SUPABASE_URL.includes('YOUR-PROJECT') && !SUPABASE_KEY.includes('YOUR-');
const sb = configured ? createClient(SUPABASE_URL, SUPABASE_KEY) : null;

const state = {
  session: null,
  me: null,
  partner: null,
  profiles: [],
  reviews: [],
  tab: 'received',
  filters: { topic: '', rating: '', status: '', sort: 'newest' },
  dashFor: 'me',
};

// ---------- Helpers ----------
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const stars = (n) => '★'.repeat(n) + '☆'.repeat(5 - n);
const profile = (id) => state.profiles.find((p) => p.id === id);
const nameOf = (id) => profile(id)?.display_name ?? '?';
const fmtDate = (d) => new Date(`${d}T00:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
const todayISO = () => {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
};
const ss = {
  get: (k) => { try { return sessionStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { sessionStorage.setItem(k, v); } catch { /* ignore */ } },
  del: (k) => { try { sessionStorage.removeItem(k); } catch { /* ignore */ } },
};

function go(hash) {
  if (location.hash === hash) route();
  else location.hash = hash;
}

function toast(msg, kind = 'error') {
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.setAttribute('role', 'status');
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3500);
}

/** Star display that supports fractions (for averages). */
function starBar(value) {
  const pct = value ? (value / 5) * 100 : 0;
  return `<span class="starbar" aria-label="${value ? value.toFixed(1) : 0} out of 5"><span class="starbar-fill" style="width:${pct}%">★★★★★</span>★★★★★</span>`;
}

// ---------- Data ----------
async function loadData() {
  const uid = state.session.user.id;
  const [p, r] = await Promise.all([
    sb.from('profiles').select('*'),
    sb.from('reviews').select('*'),
  ]);
  if (p.error || r.error) throw p.error || r.error;
  state.profiles = p.data;
  state.reviews = r.data.sort(byNewest);
  state.me = state.profiles.find((x) => x.id === uid) ?? null;
  state.partner = state.profiles.find((x) => x.id !== uid) ?? null;
}

function upsertLocal(row) {
  const i = state.reviews.findIndex((x) => x.id === row.id);
  if (i >= 0) state.reviews[i] = row;
  else state.reviews.push(row);
  state.reviews.sort(byNewest);
}

async function updateReview(id, patch) {
  const { data, error } = await sb.from('reviews').update(patch).eq('id', id).select().single();
  if (error) return toast(error.message);
  upsertLocal(data);
  route();
}

// ---------- Router ----------
function route() {
  if (!configured) return renderSetupNeeded();
  const parts = (location.hash.slice(1) || '/').split('/').filter(Boolean);

  if (!state.session) {
    if (parts.length && parts[0] !== 'login') ss.set('after-login', location.hash);
    return renderLogin();
  }
  if (!state.me || !state.partner) return renderNotMember();

  switch (parts[0]) {
    case 'review': return renderReviewForm({ username: decodeURIComponent(parts[1] || '') });
    case 'edit': return renderReviewForm({ id: parts[1] });
    case 'stats': return renderStats();
    case 'login': return go('#/');
    default: return renderHome();
  }
}

// ---------- Views ----------
function renderSetupNeeded() {
  app.innerHTML = `
    <main class="center">
      <div class="panel">
        <h1>Almost there</h1>
        <p>Add your Supabase URL and key to <code>config.js</code>, then reload.</p>
      </div>
    </main>`;
}

function renderLogin(msg = '') {
  const pending = (ss.get('after-login') || '').startsWith('#/review/');
  app.innerHTML = `
    <main class="center">
      <div class="panel login">
        <p class="eyebrow">Verified relationship reviews</p>
        <h1 class="brand-lg">Our Reviews</h1>
        ${pending ? '<p class="note">Log in to leave your review.</p>' : ''}
        <form id="login-form" class="form">
          <label>Username
            <input name="username" autocomplete="username" autocapitalize="none" spellcheck="false" required>
          </label>
          <label>Password
            <input name="password" type="password" autocomplete="current-password" required>
          </label>
          <button class="btn primary" type="submit">Log in</button>
          <p class="error" role="alert">${esc(msg)}</p>
        </form>
      </div>
    </main>`;

  app.querySelector('#login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector('button');
    btn.disabled = true;
    btn.textContent = 'Logging in…';
    const f = new FormData(e.target);
    const username = String(f.get('username')).trim().toLowerCase();
    const { data, error } = await sb.auth.signInWithPassword({
      email: `${username}@${EMAIL_DOMAIN}`,
      password: String(f.get('password')),
    });
    if (error) return renderLogin('Wrong username or password.');
    state.session = data.session;
    try {
      await loadData();
    } catch (err) {
      return renderLogin(err.message);
    }
    const next = ss.get('after-login');
    ss.del('after-login');
    go(next || '#/');
  });
}

function renderNotMember() {
  app.innerHTML = `
    <main class="center">
      <div class="panel">
        <h1>Account not linked yet</h1>
        <p>Both accounts need to exist and <code>02-profiles.sql</code> needs to be run in Supabase.</p>
        <button class="btn ghost" data-action="logout">Log out</button>
      </div>
    </main>`;
}

function renderMessage(title, body) {
  app.innerHTML = header('') + `
    <main class="wrap narrow">
      <div class="panel">
        <h1>${esc(title)}</h1>
        <p>${esc(body)}</p>
        <a class="btn primary" href="#/">Back to reviews</a>
      </div>
    </main>`;
}

function header(active) {
  return `
    <header class="top">
      <a class="brand" href="#/">Our Reviews</a>
      <nav>
        <a href="#/" class="${active === 'home' ? 'on' : ''}">Reviews</a>
        <a href="#/stats" class="${active === 'stats' ? 'on' : ''}">Stats</a>
        <button class="btn ghost sm" data-action="qr">Review me</button>
        <button class="icon-btn" data-action="logout" aria-label="Log out" title="Log out"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5"/><path d="M21 12H9"/></svg></button>
      </nav>
    </header>`;
}

function filtered(list) {
  const { topic, rating, status, sort } = state.filters;
  let out = list.filter((r) =>
    (!topic || r.topic === topic) &&
    (!rating || effRating(r) === Number(rating)) &&
    (!status ||
      (status === 'promised' && r.promised && !r.resolved) ||
      (status === 'resolved' && r.resolved) ||
      (status === 'replied' && r.reply) ||
      (status === 'unreplied' && !r.reply)));
  const sorters = {
    newest: byNewest,
    oldest: (a, b) => byNewest(b, a),
    highest: (a, b) => effRating(b) - effRating(a) || byNewest(a, b),
    lowest: (a, b) => effRating(a) - effRating(b) || byNewest(a, b),
  };
  return out.sort(sorters[sort]);
}

function select(name, options, value) {
  return `<select data-filter="${name}" aria-label="${name}">${options
    .map(([v, label]) => `<option value="${esc(v)}" ${String(v) === String(value) ? 'selected' : ''}>${esc(label)}</option>`)
    .join('')}</select>`;
}

function renderHome() {
  const { me, partner, tab, filters } = state;
  const base = tab === 'received'
    ? state.reviews.filter((r) => r.subject_id === me.id)
    : state.reviews.filter((r) => r.author_id === me.id);
  const list = filtered(base);
  const s = summarize(base);
  const topics = [...new Set(base.map((r) => r.topic))].sort();
  if (filters.topic && !topics.includes(filters.topic)) filters.topic = '';

  const heading = tab === 'received' ? `How ${esc(partner.display_name)} rates you` : `How you rate ${esc(partner.display_name)}`;
  const emptyText = base.length
    ? 'No reviews match these filters.'
    : tab === 'received'
      ? `No reviews yet. Tap “Review me” and let ${esc(partner.display_name)} scan the code.`
      : `You haven't reviewed ${esc(partner.display_name)} yet.`;

  app.innerHTML = header('home') + `
    <main class="wrap">
      <section class="hero">
        <div class="tabs" role="tablist">
          <button role="tab" aria-selected="${tab === 'received'}" data-action="tab" data-tab="received">About me</button>
          <button role="tab" aria-selected="${tab === 'written'}" data-action="tab" data-tab="written">By me</button>
        </div>
        <p class="eyebrow">${heading}</p>
        <div class="score">
          <span class="score-num">${s.count ? s.avg.toFixed(1) : '–'}</span>
          <div>
            ${starBar(s.avg)}
            <p class="muted">${s.count} review${s.count === 1 ? '' : 's'}</p>
          </div>
        </div>
      </section>

      <section class="filters">
        ${select('topic', [['', 'All topics'], ...topics.map((t) => [t, t])], filters.topic)}
        ${select('rating', [['', 'Any rating'], ...[5, 4, 3, 2, 1].map((n) => [n, `${n} ★`])], filters.rating)}
        ${select('status', [['', 'Any status'], ['promised', 'Promised'], ['resolved', 'Resolved'], ['replied', 'Replied'], ['unreplied', 'No reply']], filters.status)}
        ${select('sort', [['newest', 'Newest'], ['oldest', 'Oldest'], ['highest', 'Highest'], ['lowest', 'Lowest']], filters.sort)}
        <button class="btn ghost sm" data-action="csv">Export CSV</button>
      </section>

      <section class="list">
        ${list.length ? list.map(card).join('') : `<p class="empty">${emptyText}</p>`}
      </section>
    </main>
    <a class="fab" href="#/review/${encodeURIComponent(partner.username)}">＋ Review ${esc(partner.display_name)}</a>`;
}

function card(r) {
  const isAuthor = r.author_id === state.me.id;
  const isSubject = r.subject_id === state.me.id;
  const shown = effRating(r);
  const from = isAuthor ? 'You' : esc(nameOf(r.author_id));
  const to = isSubject ? 'you' : esc(nameOf(r.subject_id));

  const actions = [];
  if (isAuthor) {
    actions.push(`<a class="btn ghost sm" href="#/edit/${r.id}">Edit</a>`);
    actions.push(r.resolved
      ? '<button class="btn ghost sm" data-action="reopen">Reopen</button>'
      : '<button class="btn ghost sm" data-action="resolve-open">Mark resolved</button>');
    actions.push('<button class="btn ghost sm danger" data-action="delete">Delete</button>');
  }
  if (isSubject) {
    actions.push(`<button class="btn ghost sm" data-action="reply-open">${r.reply ? 'Edit reply' : 'Reply'}</button>`);
    actions.push(`<button class="btn ghost sm" data-action="react-open">${r.reaction ? 'Change reaction' : 'React'}</button>`);
    if (!r.resolved) {
      actions.push(`<button class="btn ghost sm" data-action="promise">${r.promised ? 'Withdraw promise' : 'Promise to improve'}</button>`);
    }
  }

  return `
    <article class="card" data-id="${r.id}">
      <div class="card-head">
        <span class="stars" aria-label="${shown} out of 5">${stars(shown)}</span>
        <span class="chip">${esc(r.topic)}</span>
        ${r.reaction ? `<span class="reaction" title="Reaction">${esc(r.reaction)}</span>` : ''}
      </div>
      <h3>${esc(r.title)}</h3>
      <p class="meta">${from} → ${to} · ${fmtDate(r.review_date)}</p>
      ${r.resolved && r.rerating && r.rerating !== r.rating
        ? `<p class="rerated">Re-rated after fix: <s>${r.rating}★</s> → ${r.rerating}★</p>` : ''}
      ${r.tags?.length ? `<div class="tags">${r.tags.map((t) => `<span class="tag tag-${t.replace(/\W+/g, '-').toLowerCase()}">${esc(t)}</span>`).join('')}</div>` : ''}
      ${r.comment ? `<p class="comment">${esc(r.comment)}</p>` : ''}
      ${(r.promised && !r.resolved) || r.resolved ? `
        <div class="badges">
          ${r.promised && !r.resolved ? '<span class="badge promise">Improvement promised</span>' : ''}
          ${r.resolved ? '<span class="badge ok">Resolved ✓</span>' : ''}
        </div>` : ''}
      ${r.reply ? `
        <div class="reply">
          <p class="reply-by">Response from ${isSubject ? 'you' : esc(nameOf(r.subject_id))}</p>
          <p>${esc(r.reply)}</p>
        </div>` : ''}
      <div class="actions">${actions.join('')}</div>
      <div class="slot"></div>
    </article>`;
}

function replyEditor(r) {
  return `
    <div class="inline-form">
      <textarea name="reply" rows="3" maxlength="1000" placeholder="Write your response…">${esc(r.reply ?? '')}</textarea>
      <div class="row">
        ${r.reply ? '<button class="btn ghost sm danger" data-action="reply-delete">Remove reply</button>' : ''}
        <span class="spacer"></span>
        <button class="btn ghost sm" data-action="cancel">Cancel</button>
        <button class="btn primary sm" data-action="reply-save">Save</button>
      </div>
    </div>`;
}

function reactionPicker(r) {
  return `
    <div class="inline-form">
      <div class="emoji-row">
        ${REACTIONS.map((e) => `<button class="emoji ${r.reaction === e ? 'on' : ''}" data-action="react" data-emoji="${e}" aria-label="React ${e}">${e}</button>`).join('')}
      </div>
      <div class="row">
        ${r.reaction ? '<button class="btn ghost sm danger" data-action="react" data-emoji="">Remove</button>' : ''}
        <span class="spacer"></span>
        <button class="btn ghost sm" data-action="cancel">Cancel</button>
      </div>
    </div>`;
}

function resolveEditor(r) {
  return `
    <div class="inline-form">
      <label>Re-rate now that it's fixed?
        <select name="rerating">
          <option value="">Keep ${r.rating}★</option>
          ${[5, 4, 3, 2, 1].map((n) => `<option value="${n}">${n} ★</option>`).join('')}
        </select>
      </label>
      <div class="row">
        <span class="spacer"></span>
        <button class="btn ghost sm" data-action="cancel">Cancel</button>
        <button class="btn primary sm" data-action="resolve-save">Mark resolved</button>
      </div>
    </div>`;
}

function renderReviewForm({ username, id }) {
  let r = null;
  let subject;
  if (id) {
    r = state.reviews.find((x) => x.id === id);
    if (!r || r.author_id !== state.me.id) return renderMessage('Review not found', 'It may have been deleted, or it isn’t yours to edit.');
    subject = profile(r.subject_id);
  } else {
    subject = state.profiles.find((p) => p.username === username.toLowerCase());
    if (!subject) return renderMessage('Nobody by that name', 'This link doesn’t match an account.');
    if (subject.id === state.me.id) {
      return renderMessage('You can’t review yourself', `Nice try. Show your QR code to ${state.partner.display_name} instead.`);
    }
  }

  const topics = [...new Set([...TOPICS, ...state.reviews.map((x) => x.topic)])].sort();
  const v = r ?? { topic: '', title: '', rating: 0, comment: '', review_date: todayISO(), tags: [] };

  app.innerHTML = header('') + `
    <main class="wrap narrow">
      <p class="eyebrow">${id ? 'Editing your review of' : 'Write a review for'}</p>
      <h1 class="page-title">${esc(subject.display_name)}</h1>
      <form id="review-form" class="form card">
        <fieldset class="rating-input">
          <legend>Rating</legend>
          <div class="rating-stars">
            ${[5, 4, 3, 2, 1].map((n) => `
              <input type="radio" id="star${n}" name="rating" value="${n}" ${v.rating === n ? 'checked' : ''} required>
              <label for="star${n}" title="${n} star${n > 1 ? 's' : ''}">★</label>`).join('')}
          </div>
        </fieldset>

        <label>Topic
          <input name="topic" list="topic-list" maxlength="40" required value="${esc(v.topic)}" placeholder="Pick or type your own">
          <datalist id="topic-list">${topics.map((t) => `<option value="${esc(t)}">`).join('')}</datalist>
        </label>

        <label>Title
          <input name="title" maxlength="80" required value="${esc(v.title)}" placeholder="e.g. Pasta night was a 10">
        </label>

        <label>Date
          <input name="review_date" type="date" required value="${esc(v.review_date)}">
        </label>

        <fieldset class="tag-input">
          <legend>Tags</legend>
          ${TAGS.map((t) => `
            <label class="tag-check">
              <input type="checkbox" name="tags" value="${esc(t)}" ${v.tags?.includes(t) ? 'checked' : ''}>
              <span>${esc(t)}</span>
            </label>`).join('')}
        </fieldset>

        <label>Comment
          <textarea name="comment" rows="5" maxlength="2000" placeholder="What happened?">${esc(v.comment)}</textarea>
        </label>

        <div class="row">
          <a class="btn ghost" href="#/">Cancel</a>
          <span class="spacer"></span>
          <button class="btn primary" type="submit">${id ? 'Save changes' : 'Post review'}</button>
        </div>
      </form>
    </main>`;

  app.querySelector('#review-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector('button[type=submit]');
    btn.disabled = true;
    const f = new FormData(e.target);
    const payload = {
      topic: String(f.get('topic')).trim(),
      title: String(f.get('title')).trim(),
      rating: Number(f.get('rating')),
      review_date: String(f.get('review_date')),
      tags: f.getAll('tags').map(String),
      comment: String(f.get('comment')).trim(),
    };
    const q = id
      ? sb.from('reviews').update(payload).eq('id', id)
      : sb.from('reviews').insert({ ...payload, subject_id: subject.id });
    const { data, error } = await q.select().single();
    if (error) {
      btn.disabled = false;
      return toast(error.message);
    }
    upsertLocal(data);
    state.tab = 'written';
    toast(id ? 'Review updated' : 'Review posted', 'ok');
    go('#/');
  });
}

function trendChart(trend) {
  const W = 640, H = 200, padL = 28, padR = 12, padT = 12, padB = 28;
  const x = (i) => padL + (i * (W - padL - padR)) / (trend.length - 1);
  const y = (v) => padT + ((5 - v) * (H - padT - padB)) / 4;
  const pts = trend.map((m, i) => (m.avg == null ? null : [x(i), y(m.avg), m])).filter(Boolean);
  const grid = [1, 2, 3, 4, 5].map((v) => `
    <line x1="${padL}" x2="${W - padR}" y1="${y(v)}" y2="${y(v)}" class="grid"/>
    <text x="${padL - 8}" y="${y(v) + 4}" class="axis" text-anchor="end">${v}</text>`).join('');
  const labels = trend.map((m, i) => `<text x="${x(i)}" y="${H - 8}" class="axis" text-anchor="middle">${m.label}</text>`).join('');
  const line = pts.length > 1 ? `<polyline class="trend-line" points="${pts.map(([a, b]) => `${a},${b}`).join(' ')}"/>` : '';
  const dots = pts.map(([a, b, m]) => `<circle class="trend-dot" cx="${a}" cy="${b}" r="4"><title>${m.label}: ${m.avg.toFixed(1)}★ (${m.count})</title></circle>`).join('');
  return `<svg viewBox="0 0 ${W} ${H}" class="chart" role="img" aria-label="Monthly average rating">${grid}${labels}${line}${dots}</svg>`;
}

function miniReview(r, label) {
  if (!r) return '';
  return `
    <a class="mini" href="#/">
      <span class="eyebrow">${label}</span>
      <span class="stars">${stars(effRating(r))}</span>
      <strong>${esc(r.title)}</strong>
      <span class="muted">${esc(r.topic)} · ${fmtDate(r.review_date)}</span>
    </a>`;
}

function renderStats() {
  const who = state.dashFor === 'me' ? state.me : state.partner;
  const list = state.reviews.filter((r) => r.subject_id === who.id);
  const s = summarize(list);
  const dist = distribution(list);
  const maxDist = Math.max(1, ...dist.map((d) => d.count));
  const topics = topicAverages(list);
  const trend = monthlyTrend(list);
  const { best, worst } = bestWorstThisMonth(list);
  const streak = fiveStarStreak(list);
  const open = list.filter((r) => r.promised && !r.resolved).length;
  const resolved = list.filter((r) => r.resolved).length;

  app.innerHTML = header('stats') + `
    <main class="wrap">
      <div class="tabs" role="tablist">
        <button role="tab" aria-selected="${state.dashFor === 'me'}" data-action="dash" data-who="me">Me</button>
        <button role="tab" aria-selected="${state.dashFor === 'partner'}" data-action="dash" data-who="partner">${esc(state.partner.display_name)}</button>
      </div>

      ${!list.length ? `<p class="empty">No reviews of ${state.dashFor === 'me' ? 'you' : esc(who.display_name)} yet.</p>` : `
      <section class="tiles">
        <div class="tile"><span class="tile-num">${s.avg.toFixed(1)}</span><span class="muted">Average</span></div>
        <div class="tile"><span class="tile-num">${s.count}</span><span class="muted">Reviews</span></div>
        <div class="tile"><span class="tile-num">${streak}</span><span class="muted">5★ streak</span></div>
        <div class="tile"><span class="tile-num">${open}</span><span class="muted">Open promises</span></div>
        <div class="tile"><span class="tile-num">${resolved}</span><span class="muted">Resolved</span></div>
      </section>

      <section class="card">
        <h2>Rating breakdown</h2>
        ${dist.map((d) => `
          <div class="bar-row">
            <span class="bar-label">${d.stars} ★</span>
            <span class="bar"><span class="bar-fill" style="width:${(d.count / maxDist) * 100}%"></span></span>
            <span class="bar-val">${d.count}</span>
          </div>`).join('')}
      </section>

      <section class="card">
        <h2>By topic</h2>
        ${topics.map((t) => `
          <div class="bar-row">
            <span class="bar-label" title="${esc(t.topic)}">${esc(t.topic)}</span>
            <span class="bar"><span class="bar-fill topic" style="width:${(t.avg / 5) * 100}%"></span></span>
            <span class="bar-val">${t.avg.toFixed(1)} <small>(${t.count})</small></span>
          </div>`).join('')}
      </section>

      <section class="card">
        <h2>Last 12 months</h2>
        ${trendChart(trend)}
      </section>

      ${best || worst ? `
      <section>
        <h2 class="section-title">This month</h2>
        <div class="minis">${miniReview(best, 'Best')}${miniReview(worst, 'Worst')}</div>
      </section>` : ''}
      `}
    </main>`;
}

// ---------- QR ----------
function showQR() {
  const url = `${location.origin}${location.pathname}#/review/${encodeURIComponent(state.me.username)}`;
  const qr = window.qrcode(0, 'M');
  qr.addData(url);
  qr.make();
  const svg = qr.createSvgTag({ cellSize: 8, margin: 2, scalable: true, alt: 'QR code to review me' });

  const modal = document.createElement('div');
  modal.className = 'modal';
  modal.innerHTML = `
    <div class="modal-box" role="dialog" aria-modal="true" aria-label="Review me QR code">
      <p class="eyebrow">Scan to review</p>
      <h2>${esc(state.me.display_name)}</h2>
      <div class="qr">${svg}</div>
      <p class="muted">Only ${esc(state.partner.display_name)} can leave a review after logging in.</p>
      <div class="row">
        <button class="btn ghost" data-modal="copy">Copy link</button>
        <span class="spacer"></span>
        <button class="btn primary" data-modal="close">Done</button>
      </div>
    </div>`;
  const close = () => { modal.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  modal.addEventListener('click', async (e) => {
    const a = e.target.closest('[data-modal]')?.dataset.modal;
    if (e.target === modal || a === 'close') close();
    if (a === 'copy') {
      try { await navigator.clipboard.writeText(url); toast('Link copied', 'ok'); }
      catch { toast('Copy failed: ' + url); }
    }
  });
  document.addEventListener('keydown', onKey);
  document.body.appendChild(modal);
  modal.querySelector('[data-modal=close]').focus();
}

function exportCSV() {
  const csv = toCSV(state.reviews, nameOf);
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `our-reviews-${todayISO()}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// ---------- Events ----------
app.addEventListener('click', async (e) => {
  const el = e.target.closest('[data-action]');
  if (!el) return;
  const cardEl = el.closest('.card');
  const id = cardEl?.dataset.id;
  const r = id ? state.reviews.find((x) => x.id === id) : null;
  const slot = cardEl?.querySelector('.slot');

  switch (el.dataset.action) {
    case 'logout':
      await sb.auth.signOut();
      Object.assign(state, { session: null, me: null, partner: null, profiles: [], reviews: [], tab: 'received', dashFor: 'me' });
      go('#/');
      break;
    case 'qr': showQR(); break;
    case 'tab': state.tab = el.dataset.tab; renderHome(); break;
    case 'dash': state.dashFor = el.dataset.who; renderStats(); break;
    case 'csv': exportCSV(); break;
    case 'cancel': slot.innerHTML = ''; break;
    case 'delete':
      if (!confirm('Delete this review? This can’t be undone.')) return;
      {
        const { error } = await sb.from('reviews').delete().eq('id', id);
        if (error) return toast(error.message);
        state.reviews = state.reviews.filter((x) => x.id !== id);
        renderHome();
      }
      break;
    case 'resolve-open': slot.innerHTML = resolveEditor(r); break;
    case 'resolve-save': {
      const v = cardEl.querySelector('[name=rerating]').value;
      await updateReview(id, { resolved: true, rerating: v ? Number(v) : null });
      break;
    }
    case 'reopen': await updateReview(id, { resolved: false, rerating: null }); break;
    case 'promise': await updateReview(id, { promised: !r.promised }); break;
    case 'reply-open':
      slot.innerHTML = replyEditor(r);
      slot.querySelector('textarea').focus();
      break;
    case 'reply-save': {
      const text = cardEl.querySelector('[name=reply]').value.trim();
      await updateReview(id, { reply: text || null });
      break;
    }
    case 'reply-delete': await updateReview(id, { reply: null }); break;
    case 'react-open': slot.innerHTML = reactionPicker(r); break;
    case 'react': await updateReview(id, { reaction: el.dataset.emoji || null }); break;
  }
});

app.addEventListener('change', (e) => {
  const key = e.target.dataset.filter;
  if (!key) return;
  state.filters[key] = e.target.value;
  renderHome();
});

// ---------- Boot ----------
async function init() {
  window.addEventListener('hashchange', route);
  if (configured) {
    const { data } = await sb.auth.getSession();
    state.session = data.session;
    if (state.session) {
      try {
        await loadData();
      } catch (err) {
        await sb.auth.signOut();
        state.session = null;
        toast(err.message);
      }
    }
  }
  route();
}

init();
