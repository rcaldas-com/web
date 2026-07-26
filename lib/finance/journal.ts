import clientPromise from '../mongodb';
import { getRealSessionUserId } from '@/lib/auth';

// Journaling de alterações do finance: registra o antes→depois de cada mudança
// (nome, valor, marcação de pagamento…) numa coleção à parte, só para consulta
// e auditoria. Nunca deve interferir na operação em si — se o registro falhar,
// engole o erro e segue (auditoria é canal lateral, não pode derrubar o write).
//
// Coleção: financeJournal. Índice recomendado (criar uma vez no banco):
//   db.financeJournal.createIndex({ userId: 1, at: -1 })

export type JournalEntity = 'profile' | 'card' | 'expense' | 'installment' | 'month';

// user = edição direta do usuário; derived = efeito em cascata de uma edição
// (ajuste de banco/fatura ao pagar); rollover = decremento automático de
// parcelas; migration = importação de dados. A página filtra por isso pra
// separar "o que eu editei" do ruído automático.
export type JournalSource = 'user' | 'derived' | 'rollover' | 'migration';

export interface JournalChange {
  field: string;      // chave técnica (ex.: 'value')
  label: string;      // rótulo amigável (ex.: 'Valor')
  before: unknown;    // valor anterior cru (número/string/bool) — a UI formata
  after: unknown;
  kind?: 'money' | 'text' | 'bool' | 'number'; // dica de formatação pra UI
}

export interface JournalEntry {
  _id?: string;
  userId: string;              // dono do dado
  actorUserId: string | null;  // quem alterou (≠ userId = via impersonation)
  entity: JournalEntity;
  entityId?: string;           // _id do cartão/despesa/parcela, quando houver
  entityLabel: string;         // nome amigável: "ITAU", "Aluguel", "2026-04"…
  scope?: string;              // subárea: 'valor', 'pagamento', 'fatura'…
  yearMonth?: string;          // quando é alteração de um mês específico
  action: 'create' | 'update' | 'delete';
  changes: JournalChange[];
  source: JournalSource;
  at: Date;
}

type RecordInput = Omit<JournalEntry, '_id' | 'at' | 'actorUserId'>;

// Registra uma alteração. Não bloqueante: qualquer falha é logada e ignorada.
// Updates sem nenhuma mudança real (changes vazio) não geram registro — isso
// mata o ruído dos saves que reenviam o form inteiro sem alterar nada.
export async function recordChange(entry: RecordInput): Promise<void> {
  try {
    if (entry.action === 'update' && entry.changes.length === 0) return;

    let actorUserId: string | null = null;
    try {
      actorUserId = await getRealSessionUserId();
    } catch {
      actorUserId = null;
    }

    const client = await clientPromise;
    await client.db().collection('financeJournal').insertOne({
      ...entry,
      actorUserId,
      at: new Date(),
    });
  } catch (err) {
    console.error('financeJournal: falha ao registrar alteração (ignorado):', err);
  }
}

// Comparação frouxa o suficiente pra tratar 1200 e 1200.0 como iguais e
// number/string equivalentes ("7" vs 7) sem marcar mudança falsa.
function valuesEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a == null && b == null) return true;
  if (typeof a === 'number' && typeof b === 'number') {
    return Math.round(a * 100) === Math.round(b * 100);
  }
  return String(a ?? '') === String(b ?? '');
}

type FieldSpec = { field: string; label: string; kind?: JournalChange['kind'] };

// Gera a lista de mudanças comparando os campos nomeados entre dois objetos.
// Só entra no resultado o que realmente mudou. Campos AUSENTES em `after`
// (chave não presente) são ignorados — significam "não está sendo escrito"
// (ex.: um $set parcial), não "virou nulo"; sem isso um update parcial marcaria
// falsas alterações campo→— nos campos que ele nem tocou.
export function diffFields(
  before: Record<string, unknown> | null | undefined,
  after: Record<string, unknown> | null | undefined,
  specs: FieldSpec[],
): JournalChange[] {
  const changes: JournalChange[] = [];
  for (const spec of specs) {
    if (!after || !(spec.field in after)) continue;
    const b = before?.[spec.field];
    const a = after[spec.field];
    if (!valuesEqual(b, a)) {
      changes.push({ field: spec.field, label: spec.label, before: b ?? null, after: a ?? null, kind: spec.kind });
    }
  }
  return changes;
}

// ==================== Leitura (página Histórico) ====================

export interface JournalQuery {
  entity?: JournalEntity;
  source?: JournalSource;
  limit?: number;
  skip?: number;
}

export async function getJournal(userId: string, query: JournalQuery = {}): Promise<JournalEntry[]> {
  const client = await clientPromise;
  const db = client.db();
  const filter: Record<string, unknown> = { userId };
  if (query.entity) filter.entity = query.entity;
  if (query.source) filter.source = query.source;

  const docs = await db
    .collection('financeJournal')
    .find(filter)
    .sort({ at: -1 })
    .skip(query.skip ?? 0)
    .limit(query.limit ?? 100)
    .toArray();

  return docs.map((d) => ({ ...d, _id: d._id.toString() })) as JournalEntry[];
}
