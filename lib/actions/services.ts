'use server';

import { revalidatePath } from 'next/cache';
import { requireAdmin } from '@/lib/auth';
import { getService, setServiceEnrichment, type ServiceSource } from '@/lib/services';
import { latestSuccessfulBuild } from '@/lib/builds';
import { promoteImage } from '@/lib/promote';

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

  const autoPromote = formData.get('autoPromote') === 'on';

  await setServiceEnrichment(name, {
    source: parseSource(formData),
    logPath: String(formData.get('logPath') || ''),
    url: String(formData.get('url') || ''),
    // Checkbox nao enviado = desmarcado, e o default do sistema e' promover
    // so com clique. Qualquer caminho que perca o campo erra pro lado de
    // pedir aprovacao, nunca pro lado de subir sozinho.
    autoPromote,
  });

  // Ligar a auto-promocao promove o que JA esta pronto, em vez de so' valer
  // do proximo build em diante.
  //
  // Sem isto o resultado surpreende: marcar a caixa depois que o build
  // terminou nao promovia nada, e o polling tambem nao reconstruia porque o
  // SHA nao mudou -- o servico ficava com imagem nova pronta e tag velha em
  // producao ate alguem commitar de novo. Aconteceu com site e wallet.
  //
  // Idempotente: promoteImage recusa quando a producao ja esta na tag, entao
  // salvar o formulario de novo nao gera commit a toa.
  if (autoPromote) {
    try {
      const svc = await getService(name);
      if (svc?.source?.kind === 'build' || svc?.source?.kind === 'upstream') {
        const ultimo = await latestSuccessfulBuild(name);
        if (ultimo) {
          const r = await promoteImage(`registry.rcaldas.com/rcaldas/${name}`, ultimo.tag);
          console.log(
            r.ok
              ? `auto-promocao ligada: ${name} ${r.de} -> ${r.para} (commit ${r.commit})`
              : `auto-promocao ligada em ${name}, nada a promover: ${r.erro}`
          );
        }
      }
    } catch (error) {
      // Nunca deixa o salvamento do cadastro falhar por causa disso -- a
      // caixa ja foi gravada, e o proximo build promove de qualquer forma.
      console.error(`promocao ao ligar auto-promote em ${name} falhou:`, error);
    }
  }

  revalidatePath('/monitor/servicos');
  revalidatePath(`/monitor/servicos/${name}`);
}
