import fs from 'node:fs';
import { servedScript, respostaScript } from '@/lib/served-script';
import path from 'node:path';

const APP_URL = process.env.AUTH_TRUST_HOST || 'http://localhost:8001';
// Segredo compartilhado que autoriza o /init a chamar /api/register-tunnel-key
// -- mesmo nivel de confianca que authorized_keys ja tem hoje (quem consegue
// buscar /init ja recebe suas chaves SSH).
const PROVISION_TOKEN = process.env.PROVISION_TOKEN || '';
// Mesmo diretorio que o zxnet/init.sh chamavam de $SYNC_HOME — mirror do
// home do usuario, sincronizado pelo Syncthing entre todos os hosts. Serve
// o conteudo real direto daqui, sem duplicar em outro lugar.
const SYNC_HOME_DIR = process.env.SYNC_HOME_DIR || '/var/rcaldas/live/home';
const SYNC_BIN_DIR = process.env.SYNC_BIN_DIR || '/var/rcaldas/live/bin';
const SAFE_FILENAME = /^[\w.-]+$/;
// live/bin e pra scripts, nao pra artefatos de teste/benchmark que alguem
// deixe la por engano (ja aconteceu: um arquivo de teste de disco de 129MB
// derrubou o processo inteiro com OOM ao tentar embutir tudo num template).
const MAX_BIN_FILE_BYTES = 1024 * 1024;

function readSecret(relativePath: string, placeholder: string) {
  try {
    return fs.readFileSync(path.join(SYNC_HOME_DIR, relativePath), 'utf8').replace(/\r\n/g, '\n');
  } catch {
    return placeholder;
  }
}

// Escreve cada script de $SYNC_BIN direto em $BIN_DIR no host novo, com o
// conteudo real de agora (mesma ideia de readSecret, mas pra varios arquivos).
function buildBinInstallScript() {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(SYNC_BIN_DIR, { withFileTypes: true });
  } catch {
    // ":" (no-op) e necessario -- isso pode ser inserido dentro de um bloco
    // if/else no script gerado, e um comentario sozinho deixa o bloco vazio,
    // o que e erro de sintaxe em bash.
    return `: # live/bin ainda nao sincronizado em ${SYNC_BIN_DIR}`;
  }
  const files = entries.filter((e) => e.isFile() && SAFE_FILENAME.test(e.name));
  if (!files.length) return ': # nenhum script em live/bin no momento do provisionamento';

  const parts = files.map((entry, index) => {
    // Alguns arquivos em live/bin sao propositalmente sem leitura para
    // "outros" (o processo do container nao e nem o dono nem o grupo) --
    // provavelmente por conterem algo sensivel. Pula em vez de derrubar a
    // rota inteira com EACCES.
    try {
      const filePath = path.join(SYNC_BIN_DIR, entry.name);
      if (fs.statSync(filePath).size > MAX_BIN_FILE_BYTES) {
        return `: # ${entry.name} maior que ${MAX_BIN_FILE_BYTES} bytes, pulado (nao parece ser um script)`;
      }
      const content = fs.readFileSync(filePath, 'utf8').replace(/\r\n/g, '\n');
      const delim = `BINFILE_${index}_EOF`;
      return `cat <<'${delim}' > "$BIN_DIR"/${entry.name}\n${content}\n${delim}\nchmod +x "$BIN_DIR"/${entry.name}`;
    } catch {
      return `: # ${entry.name} nao legivel pelo container, pulado`;
    }
  });

  return parts.join('\n');
}

export async function GET() {
  return respostaScript(
    servedScript('init.sh', {
      APP_URL,
      PROVISION_TOKEN,
      BASHRC: readSecret('.bashrc', `# .bashrc ainda nao sincronizado em ${SYNC_HOME_DIR}`),
      BASH_ALIASES: readSecret('.bash_aliases', '# .bash_aliases ainda nao sincronizado'),
      AUTHORIZED_KEYS: readSecret(
        '.ssh/authorized_keys',
        `# nenhuma chave sincronizada em ${SYNC_HOME_DIR}/.ssh/authorized_keys`
      ),
      SSH_CONFIG_FILE: readSecret('.ssh/config', '# .ssh/config ainda nao sincronizado'),
      BIN_INSTALL_SCRIPT: buildBinInstallScript(),
      // Chave publica do host que faz backup dos outros (o `bag` hoje).
      // Fica no mesmo diretorio sincronizado das outras chaves; se ainda
      // nao existe, o /init so avisa em vez de quebrar -- backup e opcional.
      BACKUP_RUNNER_KEY: readSecret('.ssh/backup-runner.pub', '').trim(),
    })
  );
}
