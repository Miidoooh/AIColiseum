import { describe, expect, it } from 'vitest';
import { buildBurnTransaction, MEMO_PROGRAM } from '../src/client/lib/burn-tx';
import { wardenMemo } from '../src/shared/crowd';

const token = {
  mint: 'DH4Hw4SDEXGTTsggAgn9pBMidoJnwwGG1vgu77eVpump',
  decimals: 6,
  tokenProgram: 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb',
  warden: { blackout: 50000, supply_drop: 1, rations_cut: 1, bounty: 1 },
  callItMinimumHolding: 1,
  callItLockRound: 10,
  gladiatorPrice: 1,
  models: [],
};
const OWNER = '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM';

describe('buildBurnTransaction', () => {
  it('burns the exact amount from the owner token account and carries the memo', async () => {
    const { transaction, tokenAccount } = await buildBurnTransaction(token, OWNER, 50000, wardenMemo('blackout'), { blockhash: 'EETubP5AKHgjPAhzPAFcb8BAY1hMH639CWCFTqi3hq1k', lastValidBlockHeight: 1 });
    const [burn, memo] = transaction.instructions;
    expect(burn.programId.toBase58()).toBe(token.tokenProgram);
    expect(burn.data[0]).toBe(15);
    expect(burn.data.readBigUInt64LE(1)).toBe(50_000_000_000n);
    expect(burn.data[9]).toBe(6);
    expect(burn.keys.map((k) => k.pubkey.toBase58())).toEqual([tokenAccount, token.mint, OWNER]);
    expect(burn.keys[2].isSigner).toBe(true);
    expect(memo.programId.toBase58()).toBe(MEMO_PROGRAM);
    expect(Buffer.from(memo.data).toString('utf8')).toBe('AICOLOSSEUM:WARDEN:blackout');
    expect(transaction.feePayer?.toBase58()).toBe(OWNER);
  });
});
