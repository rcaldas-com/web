import fs from 'fs';
import path from 'path';

// Le um script .sh de verdade do disco, em vez de mante-lo dentro de um
// template literal de JS.
//
// POR QUE ISTO EXISTE
// -------------------
// Bash dentro de template literal passa por UMA passada de escape do JS
// antes de virar o script servido. Isso quebrou o build sete vezes, sempre
// do mesmo jeito e sempre por acidente:
//
//   - crase em comentario ("o `set -e` mata o script") encerra o literal
//   - `${VAR}` do bash e' lido como interpolacao de JS
//   - `\n` de um printf vira quebra de linha de verdade
//
// Nenhum desses erros aparece lendo o codigo -- so' no build ou, pior, no
// host remoto em runtime. Com o bash num arquivo .sh o problema deixa de
// existir na origem: nao ha camada de escape, o shellcheck funciona, da'
// pra rodar o arquivo direto pra testar, e o editor destaca a sintaxe.
//
// A substituicao e' por MARCADOR EXPLICITO (@@NOME@@) e nao por
// interpolacao: um marcador que ninguem preencheu fica visivel no script
// servido em vez de virar string vazia silenciosa.
const DIR = path.join(process.cwd(), 'served-scripts');

export function servedScript(nome: string, vars: Record<string, string> = {}): string {
  let corpo = fs.readFileSync(path.join(DIR, nome), 'utf8');

  for (const [chave, valor] of Object.entries(vars)) {
    corpo = corpo.split(`@@${chave}@@`).join(valor);
  }

  // Marcador nao substituido e' erro de programacao, nao de operacao: o
  // script iria pro host com "@@COISA@@" no meio e falharia la', longe de
  // quem poderia consertar. Falhar aqui poe o erro onde ele nasceu.
  const orfaos = [...corpo.matchAll(/@@([A-Z_][A-Z0-9_]*)@@/g)].map((m) => m[1]);
  if (orfaos.length) {
    throw new Error(`servedScript(${nome}): marcador sem valor: ${[...new Set(orfaos)].join(', ')}`);
  }
  return corpo;
}

export function respostaScript(corpo: string): Response {
  return new Response(corpo, {
    headers: {
      'content-type': 'text/x-shellscript; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}
