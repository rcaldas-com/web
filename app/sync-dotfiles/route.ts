import { servedScript, respostaScript } from '@/lib/served-script';

// O bash vive em served-scripts/sync-dotfiles.sh -- ver lib/served-script.ts.
export async function GET() {
  return respostaScript(servedScript('sync-dotfiles.sh'));
}
