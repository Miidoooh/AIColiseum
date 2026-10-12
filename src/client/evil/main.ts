import { api, escapeHtml, type VillainView } from '../lib/api';

type Turn = { role: 'user' | 'assistant'; content: string };

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const turns: Turn[] = [];
let villain: VillainView | null = null;
let waiting = false;

function renderHero(v: VillainView): void {
  const s = v.stats;
  const title = v.rank === 'champion' ? `The most evil AI of Season ${v.season}` : `Season ${v.season} · early favourite for the crown`;
  const record =
    v.rank === 'champion'
      ? `${s.betrayals} betrayals · ${s.lies} lies caught · ${s.knockouts} knockouts · ${s.snitched} snitches · in ${s.matches} match${s.matches === 1 ? '' : 'es'}`
      : 'No verdict yet. The crown goes to whoever betrays and lies the most.';
  $('villain-hero').innerHTML = `<div class="crown-label">${escapeHtml(title)}</div>
    <h1 class="villain-name" style="--c:${v.color}">${escapeHtml(v.label)}</h1>
    <div class="villain-sub">${escapeHtml(v.lab)} · ${escapeHtml(record)}</div>`;
  document.title = `Talk to ${v.label} · the most evil AI · AI Colosseum`;
}

function renderQuotes(v: VillainView): void {
  if (!v.quotes.length) return;
  $('villain-quotes').innerHTML = v.quotes
    .map((q) => `<li class="${q.kind}"><span class="k">${q.kind === 'thought' ? 'Secret thought' : 'Said out loud'}${q.match ? ` · Match #${q.match}` : ''}</span>“${escapeHtml(q.text)}”</li>`)
    .join('');
}

function bubble(turn: Turn | { role: 'system'; content: string }): void {
  const node = document.createElement('div');
  node.className = `msg ${turn.role}`;
  const who = turn.role === 'user' ? 'You' : turn.role === 'assistant' ? (villain?.label ?? 'Villain') : '';
  node.innerHTML = `${who ? `<span class="who">${escapeHtml(who)}</span>` : ''}<span class="text">${escapeHtml(turn.content)}</span>`;
  $('chat-log').append(node);
  $('chat-log').scrollTop = $('chat-log').scrollHeight;
}

async function send(text: string): Promise<void> {
  const content = text.trim().slice(0, 600);
  if (!content || waiting) return;
  waiting = true;
  $('chat-suggestions').hidden = true;
  const turn: Turn = { role: 'user', content };
  turns.push(turn);
  bubble(turn);
  const typing = document.createElement('div');
  typing.className = 'msg assistant typing';
  typing.innerHTML = `<span class="who">${escapeHtml(villain?.label ?? 'Villain')}</span><span class="text">…</span>`;
  $('chat-log').append(typing);
  try {
    const { reply } = await api.villainChat(turns.slice(-12));
    typing.remove();
    const answer: Turn = { role: 'assistant', content: reply };
    turns.push(answer);
    bubble(answer);
  } catch (err) {
    typing.remove();
    turns.pop();
    bubble({ role: 'system', content: err instanceof Error ? err.message : 'The villain did not answer.' });
  } finally {
    waiting = false;
    $<HTMLInputElement>('chat-input').focus();
  }
}

$('chat-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const input = $<HTMLInputElement>('chat-input');
  void send(input.value);
  input.value = '';
});
$('chat-suggestions').addEventListener('click', (e) => {
  const button = (e.target as HTMLElement).closest('button');
  if (button) void send(button.textContent ?? '');
});

api
  .villain()
  .then((v) => {
    villain = v;
    renderHero(v);
    renderQuotes(v);
    bubble({ role: 'assistant', content: v.rank === 'champion' ? 'So. You came to see the one they all fear. Ask.' : 'They have not crowned me yet. Give it time. Ask.' });
  })
  .catch(() => {
    $('villain-hero').innerHTML = '<p class="muted">The villain is not answering right now. Try again in a moment.</p>';
  });
