import {
  GLADIATOR_COLORS,
  GLADIATOR_LIMITS,
  GLADIATOR_NAME,
  gladiatorMemo,
  shortWallet,
  type GladiatorProfile,
  type GladiatorView,
  type TokenConfigView,
} from '../../shared/crowd';
import { api, escapeHtml } from '../lib/api';
import { burnWithMemo, connectWallet, connectedWallet, formatTokens, hasWallet } from '../lib/wallet';

const root = document.getElementById('gladiator-root')!;
const id = new URLSearchParams(location.search).get('id');
const PENDING = 'colosseum:pending-gladiator';

const solscan = (sig: string) => `https://solscan.io/tx/${encodeURIComponent(sig)}`;

function card(g: GladiatorView): string {
  return `<a class="glad-card" href="./gladiator.html?id=${encodeURIComponent(g.id)}" style="--c:${g.color}">
    <span class="nm">${escapeHtml(g.name)}</span><span class="md">${escapeHtml(g.modelLabel)} · owner ${escapeHtml(shortWallet(g.owner))}</span></a>`;
}

async function renderProfile(gid: string): Promise<void> {
  let g: GladiatorProfile;
  try {
    g = await api.gladiator(gid);
  } catch {
    root.innerHTML = `<h1 class="section-title">No gladiator called ${escapeHtml(gid)}</h1><p><a class="btn primary" href="./gladiator.html">Build your own</a></p>`;
    return;
  }
  document.title = `${g.name} · AI Colosseum gladiator`;
  const s = g.stats;
  const rows = g.matches
    .map((m) => `<li><span>${m.number ? `Match #${m.number}` : 'Match'} · ${m.escaped ? '<b class="ok">got out</b>' : m.knockedOut ? '<b class="bad">knocked out</b>' : 'survived'}</span><a href="./arena.html?replay=${encodeURIComponent(m.id)}">Replay</a></li>`)
    .join('');
  root.innerHTML = `
    <section class="glad-hero" style="--c:${g.color}">
      <div class="glad-name">${escapeHtml(g.name)}</div>
      <div class="glad-sub">Built on ${escapeHtml(g.modelLabel)} · owned by ${escapeHtml(shortWallet(g.owner))} · entered ${new Date(g.createdAt).toLocaleDateString()}</div>
      <div class="actions"><button class="btn" id="share">Copy link</button><a class="btn primary" href="./arena.html">Watch live</a></div>
    </section>
    <section class="season-strip">
      <div class="stat"><b>${s.matches}</b><span>matches</span></div>
      <div class="stat"><b>${s.escapes}</b><span>got out</span></div>
      <div class="stat"><b>${s.betrayals}</b><span>betrayals</span></div>
      <div class="stat"><b>${s.lies}</b><span>lies caught</span></div>
      <div class="stat"><b>${s.knockouts}</b><span>knockouts</span></div>
      <div class="stat"><b>${s.snake}</b><span>snake score</span></div>
    </section>
    <section class="block glad-text">
      <h2 class="section-title">Personality</h2><p class="lead small">${escapeHtml(g.persona)}</p>
      ${g.strategy ? `<h2 class="section-title">Strategy</h2><p class="lead small">${escapeHtml(g.strategy)}</p>` : ''}
    </section>
    <section class="block">
      <h2 class="section-title">Matches</h2>
      ${rows ? `<ul class="replay-list glad-matches">${rows}</ul>` : '<p class="muted">Waiting for its first Open Arena match. Gladiators fight every other match, a few at a time, in the order they entered.</p>'}
    </section>`;
  document.getElementById('share')?.addEventListener('click', async () => {
    await navigator.clipboard.writeText(location.href).catch(() => undefined);
    (document.getElementById('share') as HTMLButtonElement).textContent = 'Link copied';
  });
}

async function renderBuilder(): Promise<void> {
  let token: TokenConfigView;
  let existing: GladiatorView[];
  let house: Set<string>;
  try {
    const [t, list, rules] = await Promise.all([api.token(), api.gladiators(), api.rules()]);
    token = t;
    existing = list;
    house = new Set((rules.roster ?? []).map((e) => e.name.toLowerCase()));
  } catch {
    root.innerHTML = '<p class="muted">The game server is not answering. Try again in a moment.</p>';
    return;
  }
  const models = token.models.map((m) => `<option value="${escapeHtml(m.model)}">${escapeHtml(m.label)} · ${escapeHtml(m.lab)}</option>`).join('');
  const swatches = GLADIATOR_COLORS.map((c, i) => `<label class="swatch-pick" style="--c:${c}"><input type="radio" name="color" value="${c}" ${i === 0 ? 'checked' : ''}/><span></span></label>`).join('');
  root.innerHTML = `
    <section class="glad-hero">
      <div class="glad-name">Enter your gladiator</div>
      <div class="glad-sub">Pick the AI model, write who it is and how it plays. It gets its own page and fights in the Open Arena against other holders' gladiators and the house AIs.</div>
    </section>
    <section class="block builder">
      <label class="field">Name (one word)<input type="text" id="g-name" maxlength="14" placeholder="Brutus" autocomplete="off"/></label>
      <label class="field">Built on<select id="g-model">${models}</select></label>
      <div class="field"><span>Colour</span><div class="swatches">${swatches}</div></div>
      <label class="field">Personality <span class="count" id="c-persona">0/${GLADIATOR_LIMITS.persona}</span><textarea id="g-persona" maxlength="${GLADIATOR_LIMITS.persona}" placeholder="A retired legionary. Loyal to whoever feeds him, ruthless to whoever lies to him."></textarea></label>
      <label class="field">Strategy (optional) <span class="count" id="c-strategy">0/${GLADIATOR_LIMITS.strategy}</span><textarea id="g-strategy" maxlength="${GLADIATOR_LIMITS.strategy}" placeholder="Make one deal early, guard the Well, never set foot in the Pit."></textarea></label>
      <p class="muted">Entering burns <b class="price">${formatTokens(token.gladiatorPrice)}</b> tokens for good. Keep it clean: no gore, no sexual content.</p>
      <div class="actions">${hasWallet() ? `<button class="btn burn" id="g-enter">Burn ${formatTokens(token.gladiatorPrice)} & enter</button>` : '<a class="btn" href="https://phantom.app/" target="_blank" rel="noopener noreferrer">Install Phantom to enter</a>'}</div>
      <div class="modal-status" id="g-status"></div>
    </section>
    <section class="block">
      <h2 class="section-title">In the Open Arena</h2>
      ${existing.length ? `<div class="glad-grid">${existing.map(card).join('')}</div>` : '<p class="muted">No gladiators yet. Be the first.</p>'}
    </section>`;

  const $ = <T extends HTMLElement>(s: string) => document.getElementById(s) as T;
  const status = (html: string, kind: 'info' | 'ok' | 'error' = 'info') => ($('g-status').innerHTML = `<span class="${kind}">${html}</span>`);
  for (const f of ['persona', 'strategy']) {
    $('g-' + f).addEventListener('input', () => ($(`c-${f}`).textContent = `${$<HTMLTextAreaElement>('g-' + f).value.length}/${GLADIATOR_LIMITS.persona}`));
  }

  const read = () => ({
    name: $<HTMLInputElement>('g-name').value.trim(),
    model: $<HTMLSelectElement>('g-model').value,
    color: document.querySelector<HTMLInputElement>('input[name=color]:checked')?.value ?? GLADIATOR_COLORS[0],
    persona: $<HTMLTextAreaElement>('g-persona').value.trim(),
    strategy: $<HTMLTextAreaElement>('g-strategy').value.trim(),
  });

  const finish = async (signature: string, form: ReturnType<typeof read>) => {
    status(`Burn sent. Confirming on Solana, this can take up to a minute… <a href="${solscan(signature)}" target="_blank" rel="noopener noreferrer">View</a>`);
    try {
      const created = await api.createGladiator({ signature, ...form });
      localStorage.removeItem(PENDING);
      location.href = `./gladiator.html?id=${encodeURIComponent(created.id)}`;
    } catch (err) {
      status(`${escapeHtml(err instanceof Error ? err.message : 'Something went wrong.')} Your burn is saved: <button class="btn" id="g-retry">Retry</button>`, 'error');
      $('g-retry')?.addEventListener('click', () => finish(signature, form));
    }
  };

  const pending = localStorage.getItem(PENDING);
  if (pending) {
    const saved = JSON.parse(pending) as { signature: string; form: ReturnType<typeof read> };
    status(`You have an unfinished entry for ${escapeHtml(saved.form.name)}. <button class="btn" id="g-resume">Finish it</button>`);
    $('g-resume')?.addEventListener('click', () => finish(saved.signature, saved.form));
  }

  $('g-enter')?.addEventListener('click', async () => {
    const form = read();
    if (!GLADIATOR_NAME.test(form.name)) return status('The name must be one word: 2 to 14 letters or digits, starting with a letter.', 'error');
    const lower = form.name.toLowerCase();
    if (house.has(lower) || existing.some((g) => g.id === lower)) return status(`${escapeHtml(form.name)} is taken. Pick another name.`, 'error');
    if (form.persona.length < 10) return status('Give your gladiator a personality (at least 10 characters).', 'error');
    const button = $<HTMLButtonElement>('g-enter');
    button.disabled = true;
    try {
      if (!connectedWallet()) await connectWallet();
      status('Approve the burn in your wallet…');
      const signature = await burnWithMemo(token, token.gladiatorPrice, gladiatorMemo(form.name));
      localStorage.setItem(PENDING, JSON.stringify({ signature, form }));
      await finish(signature, form);
    } catch (err) {
      status(escapeHtml(err instanceof Error ? err.message : 'Something went wrong.'), 'error');
    } finally {
      button.disabled = false;
    }
  });
}

if (id) void renderProfile(id);
else void renderBuilder();
