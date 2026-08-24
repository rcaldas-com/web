'use server';

import { revalidatePath } from 'next/cache';
import { requireAdmin } from '@/lib/auth';
import { setServiceEnrichment, type ServiceSource } from '@/lib/services';

// Reconstroi o `source` a partir do formulario. Cada kind tem campos
// proprios, e mandar os campos do kind errado sujaria o documento -- daí
// montar por kind em vez de espalhar tudo num objeto so.
function parseSource(formData: FormData): ServiceSource | undefined {
  const kind = String(formData.get('sourceKind') || '');
  const txt = (name: string) => String(formData.get(name) || '').trim();

  switch (kind) {
    case 'build': {
      const repo = txt('repo');
      if (!repo) return undefined;
      return { kind: 'build', repo, ref: txt('ref') || undefined, context: txt('context') || undefined };
    }
    case 'upstream': {
      const image = txt('image');
      if (!image) return undefined;
      return { kind: 'upstream', image };
    }
    case 'managed':
      return { kind: 'managed', unit: txt('unit') || undefined, configPath: txt('configPath') || undefined };
    case 'external':
      return { kind: 'external' };
    default:
      return undefined;
  }
}

export async function setServiceAction(formData: FormData) {
  await requireAdmin();
  const name = String(formData.get('name') || '');
  if (!name) return;

  await setServiceEnrichment(name, {
    source: parseSource(formData),
    logPath: String(formData.get('logPath') || ''),
    url: String(formData.get('url') || ''),
    // Checkbox nao enviado = desmarcado, e o default do sistema e' promover
    // so com clique. Qualquer caminho que perca o campo erra pro lado de
    // pedir aprovacao, nunca pro lado de subir sozinho.
    autoPromote: formData.get('autoPromote') === 'on',
  });

  revalidatePath('/monitor/servicos');
  revalidatePath(`/monitor/servicos/${name}`);
}
