import type { TokenConfigView } from '../../shared/crowd';

export const MEMO_PROGRAM = 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr';
export const ATA_PROGRAM = 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL';
const BURN_CHECKED = 15;

/**
 * A transaction that burns `amount` whole tokens from the owner's associated token account and carries a memo
 * saying what the burn pays for. Loaded lazily so pages without a wallet never download the Solana SDK.
 */
export async function buildBurnTransaction(token: TokenConfigView, ownerAddress: string, amount: number, memo: string, recent: { blockhash: string; lastValidBlockHeight: number }) {
  const [{ PublicKey, Transaction, TransactionInstruction }, { Buffer }] = await Promise.all([import('@solana/web3.js'), import('buffer')]);
  const owner = new PublicKey(ownerAddress);
  const mint = new PublicKey(token.mint);
  const program = new PublicKey(token.tokenProgram);
  const [account] = PublicKey.findProgramAddressSync([owner.toBuffer(), program.toBuffer(), mint.toBuffer()], new PublicKey(ATA_PROGRAM));

  const data = Buffer.alloc(10);
  data.writeUInt8(BURN_CHECKED, 0);
  data.writeBigUInt64LE(BigInt(Math.round(amount)) * 10n ** BigInt(token.decimals), 1);
  data.writeUInt8(token.decimals, 9);
  const burn = new TransactionInstruction({
    programId: program,
    keys: [
      { pubkey: account, isSigner: false, isWritable: true },
      { pubkey: mint, isSigner: false, isWritable: true },
      { pubkey: owner, isSigner: true, isWritable: false },
    ],
    data,
  });
  const note = new TransactionInstruction({
    programId: new PublicKey(MEMO_PROGRAM),
    keys: [{ pubkey: owner, isSigner: true, isWritable: false }],
    data: Buffer.from(memo, 'utf8'),
  });
  return { transaction: new Transaction({ feePayer: owner, ...recent }).add(burn, note), tokenAccount: account.toBase58() };
}
