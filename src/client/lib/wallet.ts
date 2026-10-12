import type { TokenConfigView } from '../../shared/crowd';
import { api } from './api';
import { buildBurnTransaction } from './burn-tx';

/** The subset of the Phantom / Solflare / Backpack injected provider we rely on. */
interface SolanaProvider {
  publicKey?: { toString(): string } | null;
  connect(): Promise<{ publicKey: { toString(): string } }>;
  signMessage(message: Uint8Array, display?: 'utf8'): Promise<{ signature: Uint8Array } | Uint8Array>;
  signAndSendTransaction(tx: unknown): Promise<{ signature: string }>;
}

declare global {
  interface Window {
    phantom?: { solana?: SolanaProvider };
    solflare?: SolanaProvider;
    backpack?: SolanaProvider;
    solana?: SolanaProvider;
  }
}

function provider(): SolanaProvider | null {
  return window.phantom?.solana ?? window.solflare ?? window.backpack ?? window.solana ?? null;
}

export function hasWallet(): boolean {
  return provider() !== null;
}

let connected: string | null = null;

export function connectedWallet(): string | null {
  return connected;
}

export async function connectWallet(): Promise<string> {
  const p = provider();
  if (!p) throw new Error('No Solana wallet found. Install Phantom or Solflare, then reload.');
  const { publicKey } = await p.connect();
  connected = publicKey.toString();
  return connected;
}

export async function signText(text: string): Promise<string> {
  const p = provider();
  if (!p || !connected) throw new Error('Connect your wallet first.');
  const out = await p.signMessage(new TextEncoder().encode(text), 'utf8');
  const bytes = out instanceof Uint8Array ? out : out.signature;
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

/** Burns `amount` whole tokens from the connected wallet with a memo, and returns the transaction signature. */
export async function burnWithMemo(token: TokenConfigView, amount: number, memo: string): Promise<string> {
  const p = provider();
  if (!p || !connected) throw new Error('Connect your wallet first.');
  const { transaction } = await buildBurnTransaction(token, connected, amount, memo, await api.blockhash());
  const { signature } = await p.signAndSendTransaction(transaction);
  return signature;
}

export function formatTokens(n: number): string {
  return n >= 1000 ? `${(n / 1000).toLocaleString('en-US', { maximumFractionDigits: 1 })}K` : n.toLocaleString('en-US');
}
