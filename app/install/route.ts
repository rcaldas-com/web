import { AGENT_VERSION, HEARTBEAT_INTERVAL_SEC } from '@/lib/monitor';
import { servedScript, respostaScript } from '@/lib/served-script';
import { STACKS } from '@/lib/stacks';

// O bash deste endpoint vive em served-scripts/install.sh -- arquivo .sh
// de verdade, sem camada de escape do JS no meio. Ver lib/served-script.ts
// pro motivo (sete quebras de build pelo mesmo acidente).
export async function GET() {
  return respostaScript(
    servedScript('install.sh', {
      APP_URL: process.env.AUTH_TRUST_HOST || 'http://localhost:8001',
      AGENT_VERSION,
      HEARTBEAT_INTERVAL_SEC: String(HEARTBEAT_INTERVAL_SEC),
      // So' o que o agente precisa pra descobrir stacks no disco -- repo/
      // branch (pra onde promover) o agente nunca usa, so' o servidor.
      STACKS_JSON: JSON.stringify(STACKS.map((s) => ({ name: s.name, dir: s.dir, composeFile: s.composeFile }))),
    })
  );
}
