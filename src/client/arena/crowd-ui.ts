import {
  CALL_POINTS,
  WARDEN_ACTIONS,
  WARDEN_ACTION_TEXT,
  callMessage,
  wardenMemo,
  type CallWindow,
  type TokenConfigView,
  type WardenAction,
} from '../../shared/crowd';
import { api, escapeHtml } from '../lib/api';
import { burnWithMemo, connectWallet, connectedWallet, formatTokens, hasWallet, signText } from '../lib/wallet';
import type { MatchModel } from './match-model';

const solscan = (sig: string) => `https://solscan.io/tx/${encodeURIComponent(sig)}`;

/** The two holder pop-ups in the arena: Pay the Warden and Call it. */
export class CrowdUi {
  private token: TokenConfigView | null = null;
  private busy = false;

  constructor(
    private readonly root: HTMLElement,
    private readonly model: MatchModel,
  ) {
    root.addEventListener('click', (e) => {
      if (e.target === root || (e.target as HTMLElement).closest('[data-close]')) this.close();
    });
  }

  close(): void {
    if (this.busy) return;
    this.root.classList.add('hidden');
    this.root.innerHTML = '';
  }

  private show(title: string, body: string): void {
    this.root.innerHTML = `<div class="modal-card" role="dialog" aria-label="${escapeHtml(title)}">
      <header><h2>${escapeHtml(title)}</h2><button class="x" data-close aria-label="Close">×</button></header>
      <div class="modal-body">${body}</div>
      <div class="modal-status" id="crowd-status"></div>
    </div>`;
    this.root.classList.remove('hidden');
  }

  private status(html: string, kind: 'info' | 'ok' | 'error' = 'info'): void {
    const node = this.root.querySelector('#crowd-status');
    if (node) node.innerHTML = `<span class="${kind}">${html}</span>`;
  }

  private async loadToken(): Promise<TokenConfigView> {
    this.token ??= await api.token();
    return this.token;
  }

  private walletButton(label: string): string {
    if (!hasWallet()) return '<a class="btn" href="https://phantom.app/" target="_blank" rel="noopener noreferrer">Install Phantom to take part</a>';
    return `<button class="btn primary" data-act>${escapeHtml(connectedWallet() ? label : `Connect wallet · ${label}`)}</button>`;
  }

  async openWarden(): Promise<void> {
    this.show('Pay the Warden', '<p class="muted">Loading prices…</p>');
    let token: TokenConfigView;
    try {
      token = await this.loadToken();
    } catch {
      this.status('The game server is not answering. Try again in a moment.', 'error');
      return;
    }
    const active = [...this.model.fighters.values()].filter((f) => f.status === 'active');
    const options = WARDEN_ACTIONS.map(
      (a, i) => `<label class="option"><input type="radio" name="warden" value="${a}" ${i === 0 ? 'checked' : ''}/>
        <span class="title">${escapeHtml(WARDEN_ACTION_TEXT[a].name)}</span><span class="price">${formatTokens(token.warden[a])}</span>
        <span class="help">${escapeHtml(WARDEN_ACTION_TEXT[a].help)}</span></label>`,
    ).join('');
    const targets = active.map((f) => `<option value="${f.id}">${escapeHtml(f.modelLabel)}</option>`).join('');
    this.show(
      'Pay the Warden',
      `<p>Burn tokens to make the Warden act in this match. Everyone sees your wallet in the feed. The tokens are burned for good.</p>
       <div class="options">${options}</div>
       <label class="field" id="bounty-target" hidden>Whose head?<select id="target">${targets}</select></label>
       <div class="actions">${this.walletButton('Burn & trigger')}</div>`,
    );
    const target = this.root.querySelector<HTMLElement>('#bounty-target')!;
    this.root.querySelectorAll<HTMLInputElement>('input[name=warden]').forEach((r) => r.addEventListener('change', () => (target.hidden = r.value !== 'bounty' || !r.checked)));
    this.root.querySelector('[data-act]')?.addEventListener('click', () => this.payWarden(token));
  }

  private async payWarden(token: TokenConfigView): Promise<void> {
    if (this.busy) return;
    const action = (this.root.querySelector<HTMLInputElement>('input[name=warden]:checked')?.value ?? 'blackout') as WardenAction;
    const target = action === 'bounty' ? this.root.querySelector<HTMLSelectElement>('#target')?.value : undefined;
    if (action === 'bounty' && !target) return this.status('Pick whose head gets the price.', 'error');
    this.busy = true;
    let signature: string;
    try {
      if (!connectedWallet()) await connectWallet();
      this.status('Approve the burn in your wallet…');
      signature = await burnWithMemo(token, token.warden[action], wardenMemo(action, target));
    } catch (err) {
      this.busy = false;
      this.status(escapeHtml(err instanceof Error ? err.message : 'Something went wrong.'), 'error');
      return;
    }
    await this.redeemWarden(signature, action);
  }

  /** Confirms a burn with the server. A burn that has landed can be retried without burning again. */
  private async redeemWarden(signature: string, action: WardenAction): Promise<void> {
    this.busy = true;
    this.status(`Burn sent. Confirming on Solana, this can take up to a minute… <a href="${solscan(signature)}" target="_blank" rel="noopener noreferrer">View</a>`);
    try {
      const receipt = await api.payWarden(signature);
      this.status(`Done. The Warden heard you: <b>${escapeHtml(WARDEN_ACTION_TEXT[action].name)}</b> hits next round. ${formatTokens(receipt.burned)} burned. <a href="${solscan(signature)}" target="_blank" rel="noopener noreferrer">Transaction</a>`, 'ok');
    } catch (err) {
      this.status(`${escapeHtml(err instanceof Error ? err.message : 'Something went wrong.')} <button class="btn" id="warden-retry">Retry with the same burn</button>`, 'error');
      this.root.querySelector('#warden-retry')?.addEventListener('click', () => this.redeemWarden(signature, action));
    } finally {
      this.busy = false;
    }
  }

  async openCall(): Promise<void> {
    this.show('Call it', '<p class="muted">Checking which match is open…</p>');
    let window: CallWindow;
    let token: TokenConfigView;
    try {
      [window, token] = await Promise.all([api.callWindow(), this.loadToken()]);
    } catch {
      this.status('The game server is not answering. Try again in a moment.', 'error');
      return;
    }
    if (!window.open || !window.match) {
      this.show('Call it', `<p>${escapeHtml(window.reason ?? 'Calls are closed right now.')}</p><p class="muted">Calls open in the break between matches, when the next lineup is announced, and stay open until round ${token.callItLockRound}.</p>`);
      return;
    }
    const chips = window.candidates
      .map((c) => `<label class="pick" style="--c:${c.color}"><input type="checkbox" name="escape" value="${c.id}"/><span>${escapeHtml(c.label)}</span></label>`)
      .join('');
    const options = window.candidates.map((c) => `<option value="${c.id}">${escapeHtml(c.label)}</option>`).join('');
    this.show(
      `Call it · Match #${window.match}`,
      `<p>Free to play for holders of at least ${formatTokens(token.callItMinimumHolding)} tokens. You sign a message, nothing is spent. Calls close at round ${window.closesAtRound}.</p>
       <div class="field"><span>Who gets out? (pick one or two) <em>+${CALL_POINTS.escape} each</em></span><div class="picks">${chips}</div></div>
       <label class="field">Who betrays first? <em>+${CALL_POINTS.firstBetrayal}</em><select id="first-betrayal">${options}</select></label>
       <label class="field">Who ends up the biggest snake? <em>+${CALL_POINTS.snake}</em><select id="snake">${options}</select></label>
       <div class="actions">${this.walletButton('Sign & lock in')}</div>`,
    );
    const boxes = [...this.root.querySelectorAll<HTMLInputElement>('input[name=escape]')];
    boxes.forEach((b) =>
      b.addEventListener('change', () => {
        if (boxes.filter((x) => x.checked).length > 2) b.checked = false;
      }),
    );
    this.root.querySelector('[data-act]')?.addEventListener('click', () => this.submitCall(window));
  }

  private async submitCall(window: CallWindow): Promise<void> {
    if (this.busy || !window.match) return;
    const escape = [...this.root.querySelectorAll<HTMLInputElement>('input[name=escape]:checked')].map((b) => b.value);
    if (!escape.length) return this.status('Pick at least one AI to get out.', 'error');
    const picks = {
      escape,
      firstBetrayal: this.root.querySelector<HTMLSelectElement>('#first-betrayal')!.value,
      snake: this.root.querySelector<HTMLSelectElement>('#snake')!.value,
    };
    this.busy = true;
    try {
      const wallet = connectedWallet() ?? (await connectWallet());
      this.status('Sign the message in your wallet…');
      const signature = await signText(callMessage({ season: window.season, match: window.match, wallet, picks }));
      await api.submitCall({ wallet, picks, signature });
      this.status(`Locked in for Match #${window.match}. Points land when the match ends. You can change your call until round ${window.closesAtRound}.`, 'ok');
    } catch (err) {
      this.status(escapeHtml(err instanceof Error ? err.message : 'Something went wrong.'), 'error');
    } finally {
      this.busy = false;
    }
  }
}
