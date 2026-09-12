import { servedScript, respostaScript } from '@/lib/served-script';

// Provisionamento minimo e SEM perguntas: deixa o host alcancavel pelo
// tunel e para por ai. Existe pra quando nao da pra ficar respondendo
// prompt -- host sem tela, instalacao remota, alguem executando por voce.
// O resto (docker, desktop...) se faz depois, entrando pelo tunel.
//
// Usa o hostname do proprio sistema. Se precisar de outro, rode o /init
// completo, que pergunta.
//
// O bash vive em served-scripts/init-auto.sh -- ver lib/served-script.ts.
export async function GET() {
  return respostaScript(
    servedScript('init-auto.sh', {
      APP_URL: process.env.AUTH_TRUST_HOST || 'http://localhost:8001',
      PROVISION_TOKEN: process.env.PROVISION_TOKEN || '',
    })
  );
}
