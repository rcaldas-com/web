import { servedScript, respostaScript } from '@/lib/served-script';

// O bash vive em served-scripts/remove-zxnet.sh -- ver lib/served-script.ts.
export async function GET() {
  return respostaScript(servedScript('remove-zxnet.sh'));
}
