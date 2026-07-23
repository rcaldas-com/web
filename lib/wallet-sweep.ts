import 'server-only';
import {
  Horizon,
  Keypair,
  TransactionBuilder,
  Networks,
  Operation,
  Asset,
  BASE_FEE,
} from '@stellar/stellar-sdk';
import { ObjectId } from 'mongodb';
import clientPromise from './mongodb';

// Mesma configuração de rede do app wallet (lib/wallet-sweep.ts é uma versão
// enxuta de wallet/app/lib/stellar.ts, só com o necessário para varrer e
// encerrar a carteira de um usuário na exclusão de conta).
const HORIZON_URL = process.env.STELLAR_HORIZON || 'https://horizon.stellar.org';
const NETWORK_PASSPHRASE =
  (process.env.STELLAR_NETWORK || 'public') === 'testnet'
    ? Networks.TESTNET
    : Networks.PUBLIC;

const STELLAR_WALLET_TYPES = ['main', 'stellar'];

type WalletDoc = {
  _id: ObjectId;
  user: ObjectId;
  type: string;
  key: string;
  secret?: string | null;
  readOnly?: boolean;
};

type IssuerDoc = {
  name: string;
  public_key: string;
};

function getServer(): Horizon.Server {
  return new Horizon.Server(HORIZON_URL);
}

function getMainWallet(): Keypair {
  const secret = process.env.MAIN_WALLET;
  if (!secret) {
    throw new Error('MAIN_WALLET não configurada no ambiente.');
  }
  return Keypair.fromSecret(secret);
}

function isNotFound(err: unknown): boolean {
  const anyErr = err as { response?: { status?: number }; name?: string };
  return anyErr?.response?.status === 404 || anyErr?.name === 'NotFoundError';
}

async function baseFee(server: Horizon.Server): Promise<string> {
  try {
    const fee = await server.fetchBaseFee();
    return String(fee);
  } catch {
    return BASE_FEE;
  }
}

async function loadAccountWithRetry(
  server: Horizon.Server,
  publicKey: string,
  attempts = 5,
  delayMs = 1000,
) {
  for (let i = 0; i < attempts; i++) {
    try {
      return await server.loadAccount(publicKey);
    } catch (err) {
      if (isNotFound(err) && i < attempts - 1) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        continue;
      }
      throw err;
    }
  }
  throw new Error('unreachable');
}

async function getAllIssuers(): Promise<IssuerDoc[]> {
  const client = await clientPromise;
  const docs = await client
    .db()
    .collection('issuer')
    .find({}, { projection: { name: 1, public_key: 1 } })
    .toArray();
  return docs
    .filter((d) => d.public_key)
    .map((d) => ({ name: d.name as string, public_key: d.public_key as string }));
}

export async function getUserWallets(userId: string): Promise<WalletDoc[]> {
  const client = await clientPromise;
  const docs = await client
    .db()
    .collection('wallet')
    .find({ user: new ObjectId(userId) })
    .toArray();
  return docs.map((d) => ({
    _id: d._id,
    user: d.user,
    type: d.type,
    key: d.key,
    secret: d.secret ?? null,
    readOnly: d.readOnly ?? false,
  }));
}

export type SweepBalanceLine = {
  coin: string;
  amount: string;
  destination: 'issuer' | 'main';
};

export type SweepPreview =
  | { blocked: true; reason: string }
  | { blocked: false; wallets: { key: string; lines: SweepBalanceLine[]; willCloseAccount: boolean }[] };

// Classifica os saldos on-chain de cada wallet custodiada do usuário, sem
// submeter nada — usado para mostrar ao admin antes de confirmar a exclusão.
export async function previewSweep(userId: string): Promise<SweepPreview> {
  const wallets = await getUserWallets(userId);

  const unsupported = wallets.find(
    (w) => !STELLAR_WALLET_TYPES.includes(w.type) && w.secret,
  );
  if (unsupported) {
    return {
      blocked: true,
      reason: `Usuário possui uma carteira "${unsupported.type}" custodiada, não suportada por esta ação. Remova-a manualmente antes de excluir o usuário.`,
    };
  }

  const server = getServer();
  const issuers = await getAllIssuers();
  const result: { key: string; lines: SweepBalanceLine[]; willCloseAccount: boolean }[] = [];

  for (const wallet of wallets) {
    if (!STELLAR_WALLET_TYPES.includes(wallet.type) || !wallet.secret) {
      // readOnly ou sem secret: nada custodiado para varrer.
      continue;
    }

    let balances: Horizon.HorizonApi.BalanceLine[];
    try {
      const account = await server.loadAccount(wallet.key);
      balances = account.balances;
    } catch (err) {
      if (isNotFound(err)) continue;
      throw err;
    }

    const lines: SweepBalanceLine[] = [];
    for (const b of balances) {
      if (b.asset_type === 'native') {
        const amount = parseFloat(b.balance);
        if (amount > 0) lines.push({ coin: 'XLM', amount: b.balance, destination: 'main' });
        continue;
      }
      if (!('asset_code' in b)) continue;
      const amount = parseFloat(b.balance);
      if (amount <= 0) continue;
      const ours = issuers.some(
        (i) => i.name === b.asset_code && i.public_key === b.asset_issuer,
      );
      lines.push({ coin: b.asset_code, amount: b.balance, destination: ours ? 'issuer' : 'main' });
    }

    result.push({ key: wallet.key, lines, willCloseAccount: true });
  }

  return { blocked: false, wallets: result };
}

// Varre e encerra (accountMerge) todas as wallets Stellar custodiadas do
// usuário. Lança erro (sem apagar nada) se qualquer etapa falhar — a exclusão
// do usuário no chamador deve abortar inteira nesse caso.
export async function sweepAndCloseUserWallets(userId: string): Promise<void> {
  const wallets = await getUserWallets(userId);

  const unsupported = wallets.find(
    (w) => !STELLAR_WALLET_TYPES.includes(w.type) && w.secret,
  );
  if (unsupported) {
    throw new Error(
      `Usuário possui uma carteira "${unsupported.type}" custodiada, não suportada por esta ação.`,
    );
  }

  const server = getServer();
  const issuers = await getAllIssuers();
  const mainWallet = getMainWallet();

  for (const wallet of wallets) {
    if (!STELLAR_WALLET_TYPES.includes(wallet.type) || !wallet.secret) {
      continue;
    }

    const userKp = Keypair.fromSecret(wallet.secret);

    let account;
    try {
      account = await server.loadAccount(wallet.key);
    } catch (err) {
      if (isNotFound(err)) continue; // conta nunca chegou a existir on-chain
      throw err;
    }

    const nonNative = account.balances.filter(
      (b: Horizon.HorizonApi.BalanceLine): b is Horizon.HorizonApi.BalanceLineAsset =>
        b.asset_type !== 'native' && 'asset_code' in b,
    );
    const toSweep = nonNative.filter((b: Horizon.HorizonApi.BalanceLineAsset) => parseFloat(b.balance) > 0);

    // 1) Devolve cada token: ao issuer se for nosso, senão para a MAIN_WALLET.
    if (toSweep.length > 0) {
      const acc = await loadAccountWithRetry(server, wallet.key);
      const fee = await baseFee(server);
      let builder = new TransactionBuilder(acc, { fee, networkPassphrase: NETWORK_PASSPHRASE });
      for (const b of toSweep) {
        const asset = new Asset(b.asset_code, b.asset_issuer);
        const ours = issuers.find((i) => i.name === b.asset_code && i.public_key === b.asset_issuer);
        const destination = ours ? ours.public_key : mainWallet.publicKey();
        builder = builder.addOperation(
          Operation.payment({ destination, asset, amount: b.balance }),
        );
      }
      const tx = builder.setTimeout(60).build();
      tx.sign(userKp);
      await server.submitTransaction(tx);
    }

    // 2) Remove todas as trustlines e encerra a conta (accountMerge) numa só
    // transação atômica — a reserva liberada pelas trustlines cobre a taxa e
    // o merge devolve 100% do XLM restante para a MAIN_WALLET.
    const accForClose = await loadAccountWithRetry(server, wallet.key);
    const fee = await baseFee(server);
    let closeBuilder = new TransactionBuilder(accForClose, {
      fee,
      networkPassphrase: NETWORK_PASSPHRASE,
    });
    for (const b of nonNative) {
      closeBuilder = closeBuilder.addOperation(
        Operation.changeTrust({ asset: new Asset(b.asset_code, b.asset_issuer), limit: '0' }),
      );
    }
    closeBuilder = closeBuilder.addOperation(
      Operation.accountMerge({ destination: mainWallet.publicKey() }),
    );
    const closeTx = closeBuilder.setTimeout(60).build();
    closeTx.sign(userKp);
    await server.submitTransaction(closeTx);
  }
}

export async function deleteUserWalletDocs(userId: string): Promise<void> {
  const client = await clientPromise;
  await client.db().collection('wallet').deleteMany({ user: new ObjectId(userId) });
}
