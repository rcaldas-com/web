import { servedScript, respostaScript } from '@/lib/served-script';

// O bash vive em served-scripts/atualiza-imagens.sh -- ver lib/served-script.ts.
// Mesmo codigo para tres usos: o agente (jobs image-check/image-apply), o
// ~/live/bin/atualiza-imagens na mao, e qualquer host novo via curl | bash.
// Sem segredo nenhum: so' le o que o docker do host ja sabe.
export async function GET() {
  return respostaScript(servedScript('atualiza-imagens.sh'));
}
