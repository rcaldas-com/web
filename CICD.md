# CI/CD — build no worker, promoção pelo Monitor

> Plano de implementação, escrito pra ser revisado **antes** de virar
> código. O que está marcado como medido foi verificado na máquina em
> 23/08/2026; o resto é desenho.

## O problema

Build e deploy são manuais: imagem construída à mão, empurrada à mão, tag
editada à mão. Historicamente a tag era editada **direto no `us`** sem
commit, e o git ficava atrás do que rodava de fato.

Hoje a deriva está zerada (medido: `docker-compose.prod.yml` sem diff
local, `us` em sincronia com `origin/main`, imagens em `docker ps`
idênticas às declaradas — fora o `patty`, que é outra stack). Mas isso
depende de disciplina, e disciplina não escala pra seis serviços.

## Decisões fechadas

| decisão | escolha |
|---|---|
| arquitetura | **nativa no Monitor** — job novo na fila que já existe, sem runner externo nem webhook exposto |
| gatilho | **polling** |
| quando buildar | **sempre** que o SHA mudar; o cache decide o custo e o **digest** decide se publica |
| tag | **short SHA** |
| aprovação | **sempre manual**, com caixa de auto-aprovar por serviço |
| worker | **`bag` permanente**; `tp` habilitado sob demanda (é notebook — fechado, o job ficaria pendente; a seleção ignora worker sem heartbeat recente) |
| alvo de deploy | `us`, **nunca** buildando |
| retenção | TTL no Mongo onde couber (ver seção própria) |
| quem promove | admin, como o resto do `/monitor` |

**Por que não buildar no `us`** (medido): 3921Mi de RAM, 1332Mi
disponíveis, **zero swap**, 2 cores. Um `next build` passa de 1GB de pico;
sem swap o OOM killer escolhe a vítima, e ela pode ser o Mongo ou o Mailu.

## O que já existe e será reaproveitado

| peça | onde | serve pra |
|---|---|---|
| fila de jobs por host, tipos em whitelist | `AgentJob`, `/agent-jobs` | mandar `build` sem abrir porta no worker |
| results duráveis no heartbeat | `pending-results.json` → `monitor_results` | receber o resultado sem polling reverso |
| incidente agnóstico de origem | `upsertIncident`, result `type:"alarm"` | build que falha vira incidente **sem código novo** |
| papel de host | `backupRunner.enabled` | molde do `buildWorker` |
| auto-update do agente | job `update-agent` por divergência de `AGENT_VERSION` | distribuir o agente que entende o job `build` |
| registry próprio com htpasswd | `registry:2` no `us` | destino do push |
| log centralizado, 90 dias | Grafana + Loki | log de build sem inventar canal |

Medido: **`bag` e `tp` já têm credencial do registry** (`registry.rcaldas.com`
em `~/.docker/config.json`), já têm o repo com submódulos e a chave git
certa, e `bag`/`tp`/`us` estão no agente **2.3.0**.

---

## Modelo de dados: dois eixos

"Esse serviço é buildável?" leva a um registro que apodrece. As perguntas
certas são duas, independentes: **quem produz o artefato** e **quem
executa**.

```ts
type MonitorService = {
  name: string;
  source:
    | { kind: 'build';    repo: string; ref?: string; context?: string }
    | { kind: 'upstream'; image: string }
    | { kind: 'managed';  unit?: string; configPath?: string }
    | { kind: 'external' };
  deployment:
    | { kind: 'compose'; host: string; project: string; service: string }
    | { kind: 'systemd'; host: string; unit: string }
    | { kind: 'none' };
  logPath?: string;
  url?: string;
  autoPromote?: boolean;
};
```

| origem | serviços de hoje | pipeline |
|---|---|---|
| `build` | web, car, wallet, site, ccxt, emailer | completa |
| `upstream` | mongo, redis, registry, nginx, grafana, loki, alloy, mailu | sem build; polling de tag nova + **o mesmo botão de promover** |
| `managed` | haproxy, webssh, webvnc, certbot, nftables | nenhuma — a página entrega inventário |
| `external` | S3/Storj, Cloudflare | só saúde e dependência |

`upstream` costuma ser esquecida e é a de melhor retorno: hoje ninguém
fica sabendo que saiu um Mongo novo. A metade cara (aprovar → commitar tag
→ reconciliar) é idêntica à do `build`, então o custo marginal é quase zero.

`managed` não é "N/A": é onde mora o problema que o `CLAUDE.md` registra —
a jail do fail2ban apontando pro caminho velho do log do Mongo, que ninguém
percebeu até um restart derrubar o fail2ban. `logPath`/`configPath` existem
por causa disso.

O eixo 2 é o que porta pro Kubernetes: acrescenta-se
`{ kind: 'k8s'; namespace; workload }` e troca-se o executor. A UI, o
histórico e o botão não mudam.

---

## Fases

### Fase 0 — pré-requisitos ✅ feito

- [x] repo em `/var/rcaldas/rcaldas` nos três hosts
- [x] credencial do registry nos workers
- [x] chave git com acesso aos submódulos nos workers
- [x] `bag`, `tp`, `us` no agente 2.3.0

### Fase 1 — registro de serviços ✅ em produção

Collection `monitor_services`, páginas `/monitor/servicos[/<nome>]`, no
padrão da página de host.

**O registro nasce derivado, não digitado.** Job novo `service-inventory`:
o agente roda `docker compose config --format json` e reporta os serviços
com imagem e nome. Inventário digitado à mão rota — o fail2ban é a prova.
À mão fica só o enriquecimento (origem, `logPath`, URL, auto-promoção).

**Entrega sozinha:** inventário navegável **e detecção de deriva** — o
Monitor compara o que o git declara com o que o host roda, e divergência
abre incidente pelo pipeline de alarme existente.

### Fase 2 — papel de worker + job `build` ✅ em produção

`buildWorker?: { enabled?: boolean }` em `MonitorHost`. Ao contrário do
`backupRunner`, **vários** podem estar ativos; seleção entre os habilitados
e vivos, o com menos jobs pendentes.

```
git -C /var/rcaldas/rcaldas fetch --recurse-submodules
git worktree add /var/rcaldas/build/<repo> <sha>      # árvore limpa
docker build -t registry.rcaldas.com/rcaldas/<svc>:<sha8> <ctx>
docker push  registry.rcaldas.com/rcaldas/<svc>:<sha8>
git worktree remove /var/rcaldas/build/<repo>
```

⚠️ **Buildar do checkout de trabalho seria um bug.** O `docker build` usa o
diretório como contexto e arrasta arquivos **não commitados** pra dentro da
imagem. Build "do commit X" tem que sair de árvore limpa; `git worktree`
faz isso sem re-clonar.

⚠️ **Bootstrap:** agente antigo não conhece o tipo `build` e não consegue
executar o job que o ensinaria. Subir `AGENT_VERSION` **antes** de
enfileirar qualquer build — o `update-agent` já dispara sozinho por
divergência, e os hosts vivos se atualizam em um ciclo.

**Log do build:** o result é um campo de JSON e não cabe um `next build`
inteiro. Mandar só o rabo em caso de falha; o log completo já vai pro Loki
via `/var/log/rcaldas-agent.log`.

**Serialização:** a fila já é por host e o agente processa em série — dois
builds no mesmo worker não disputam o daemon.

### Fase 3 — polling ✅ aguardando imagem

Mesmo padrão da varredura de hosts offline: pendurado no heartbeat, trava
no Redis, 5 min.

#### Onde a latência mora

O agente manda o resultado de um job na batida **seguinte** à que o
processou (`pending-results.json` só sobe no próximo heartbeat), então o
intervalo entra cinco vezes no ciclo — não uma:

| passo | espera |
|---|---|
| trava do polling detectar o commit | até 290s |
| worker pega o `repo-heads` | 1 batida |
| worker reporta o `repo-heads` | 1 batida |
| worker pega o `build` | 1 batida |
| worker reporta o build (dispara a promoção) | 1 batida |
| `us` pega o `deploy` | 1 batida |

Daí o ritmo ser por host (`HEARTBEAT_FAST_INTERVAL_SEC`, 30s) em vez de
global: as cinco batidas acontecem só em quem constrói, implanta, roteia
ou serve de proxy. Dobrar a frequência da frota inteira pagaria tráfego em
host que não participa de nenhum desses passos.

O agente lê `nextIntervalSec` do heartbeat e reescreve o próprio timer
quando o valor muda — marcar um host como worker na UI muda o ritmo dele
na batida seguinte, sem reinstalar nada, e o instalador preserva o ritmo
já em uso a cada atualização de agente.

> Condição para isso: o log do agente teve que parar de registrar a
> resposta inteira do heartbeat a cada batida (59 linhas/h por host, ~1MB
> só no `us`, todas idênticas). Registrando só o que **acontece**, mais um
> resumo por hora, o host de 30s gera menos log do que gerava a 60s.

**Sem token do GitHub:** o worker já tem a chave e `git ls-remote` não tem
rate limit. O agente reporta os `HEAD` dos repos como result leve, e o
servidor compara com o último buildado.

> A alternativa é um token no `.env` do `web`. Funciona, mas a API não
> autenticada dá 60 req/h por IP — 6 repos a cada 5 min dão 72/h, ou seja
> **estoura sem token**. Daí a via do agente ser a recomendada.

"Commit que altera a imagem final" **não se detecta por caminho de
arquivo** — erra nos dois sentidos (mexer no `Dockerfile` não muda path de
app; mexer no `package.json` muda tudo). Builda sempre; se nada que entra
na imagem mudou, o cache resolve em segundos e o **digest sai idêntico** —
aí não se publica tag. O build vira o detector, e ele não erra.

### Fase 4 — página do serviço e promoção ✅ aguardando GITHUB_TOKEN

Collection `monitor_builds`: serviço, sha, tag, digest, worker, status,
início, duração.

Botão **promover** → o Monitor edita a linha `image:` daquele serviço no
`docker-compose.prod.yml` e commita no `dev`.

#### Os três estados de um build

Promover **não** coloca nada em produção na hora: escreve a tag e enfileira
o deploy. Quem confirma a chegada é o inventário. Daí a tela ter três
estados por build, e não dois:

| condição | mostra |
|---|---|
| tag ≠ produção e ≠ promovida | botão **promover** |
| tag = `promoted.tag` e ≠ produção | **promovida, aguardando o host** |
| tag = produção | **em produção** |

O estado do meio existe porque sem ele a tela voltava idêntica depois do
clique — nenhum sinal de que a ação valeu, e o caminho natural era clicar
de novo. O botão **some** em vez de desabilitar: promover a mesma tag não
quebraria nada, mas botão cinza ainda parece clicável.

`promoted` fica no documento do serviço (não em estado de tela) para
sobreviver ao refresh e a outra aba, e é gravado dentro de `promoteImage`
— são três caminhos que promovem (botão, auto-promoção ao terminar build,
e ligar a caixa) e deixar a cargo de cada um garantiria o esquecimento de
algum. O estado se limpa por comparação com o observado, sem flag
"pendente" que alguém precise zerar.

**Editar a linha, não gerar o arquivo:** o compose tem volumes, redes,
limites e comentários escritos à mão. A linha `image:` é alvo estável e
único por serviço. Validar que o YAML ainda faz parse antes de commitar. É
o que a automação de imagem do Flux faz — este é o caminho **mais**
portável, não menos.

Credencial: `GITHUB_TOKEN` no `.env` do `us` (onde já moram `CF_TOKEN`,
`PROVISION_TOKEN`, `MAILU_API_TOKEN`). ⚠️ O token em uso hoje tem
permissão de **admin** no repo — bem mais amplo do que a promoção precisa,
que é só `Contents: Read and write` em `rcaldas-com/dev`. Vale estreitar:
se esse `.env` vazar, a diferença importa.

`autoPromote` nasce desmarcado em todos. Primeiro candidato: `site`.

### Fase 5 — reconciliação no alvo

O host alvo compara, a cada heartbeat, o SHA local com o remoto; diferente
→ `git pull` + `docker compose up -d`.

- **Só fast-forward**, nunca `reset --hard`: o `.env` não está no git
  (`.gitignore` tem `.env*`) e há ajustes manuais legítimos no host.
- **`up -d` global**, não por serviço: `wallet` depende de `ccxt` e
  `redis`, e deploy isolado ignora `depends_on`.
- É o modelo do Flux. Trocar o executor por `kubectl apply` transforma isso
  em deploy de cluster sem tocar em mais nada.

### Fase 6 — falha vira incidente

Quase de graça: result com `type:"alarm"` e `status:"fail"` já entra no
`upsertIncident`, com dedupe, email só na transição e teto de 10
emails/host/hora.

---

## Retenção: TTL no Mongo

Estado medido em 23/08/2026 — **nenhuma coleção tem índice além do
`_id_`**:

| coleção | docs | tamanho | cresce pra sempre? |
|---|---|---|---|
| `monitor_results` | 4257 | 0,67 MB | **sim** |
| `monitor_agent_jobs` | 4144 | 0,66 MB | **sim** |
| `monitor_incidents` | 40 | 0,01 MB | sim, devagar |
| `monitor_hosts` | 7 | 0,01 MB | não |
| `monitor_tunnel_key_requests` | 5 | ~0 | sim, devagar |

O volume ainda é irrisório, mas as duas primeiras não têm teto e
`monitor_builds` vai nascer no mesmo padrão.

**A regra de ouro: TTL no campo de conclusão, nunca em `createdAt`.** O TTL
do Mongo só apaga documentos onde o campo indexado é uma `Date` — quem não
tem o campo é ignorado pra sempre. Indexando `doneAt`/`resolvedAt`,
incidente **aberto** e job **pendente** nunca somem sozinhos, por
construção. Indexar `createdAt` apagaria exatamente o que não pode sumir.

| coleção | campo | prazo | por quê |
|---|---|---|---|
| `monitor_results` | `receivedAt` | 90 dias | casa com o Loki |
| `monitor_agent_jobs` | `doneAt` | 30 dias | caminho normal |
| `monitor_agent_jobs` | `createdAt` | 90 dias | **backstop**, ver abaixo |
| `monitor_incidents` | `resolvedAt` | 180 dias | histórico de auditoria |
| `monitor_builds` | `finishedAt` | 90 dias | quando existir (Fase 4) |

⚠️ `monitor_results` usa **`receivedAt`**, não `createdAt` — conferido no
banco. TTL apontando pra campo inexistente não dá erro nenhum: simplesmente
nunca apaga nada, em silêncio. É o modo de falha mais traiçoeiro deste
recurso.

`monitor_results` é a exceção à regra do campo de conclusão: ele **é** o
registro de conclusão, não tem estado pendente.

**O backstop de `monitor_agent_jobs`** existe porque job que nunca conclui
também nunca ganha `doneAt`, e ficaria eterno. Não é hipotético: há 4 jobs
do tipo `tunnel` de 15/08/2026 presos em `pending`/`sent`, de um tipo que
nem está mais na whitelist de `AgentJob` — nunca serão executados. Os 90
dias dão folga pra um host offline voltar e pegar o job que o esperava, e
ainda assim nada fica eterno.

`monitor_tunnel_key_requests` ficou **de fora** de propósito: são 5
documentos, sem pressão de crescimento, e expirar um registro de aprovação
de chave sem antes rastrear o fluxo inteiro é risco desnecessário.

**Verificado ao vivo** (não só por leitura): com os índices criados,
inseri quatro documentos de borda e esperei o TTL monitor do Mongo passar —
concluído há 60d foi apagado; **pendente há 60d sem `doneAt` sobreviveu**;
pendente há 120d caiu no backstop; e incidente **aberto** há 300 dias ficou
intacto. É a premissa que sustenta o desenho todo.

Junto com o TTL entraram os índices de consulta que até então faziam
varredura de coleção: `{host, status}` em `monitor_agent_jobs`,
`{host, receivedAt}` em `monitor_results`, e `{key, status}` +
`{target, openedAt}` em `monitor_incidents` — os dois últimos são
exatamente o que `upsertIncident` consulta a cada alarme (dedupe por chave
e teto de emails por host/hora).

Implementado em `ensureMonitorIndexes()` no `lib/monitor.ts`, seguindo o
padrão de `ensureIndexes()` do `lib/shortlinks.ts`: criado sob demanda no
heartbeat, com guarda de módulo, e falha de criação **não derruba o
heartbeat** — sem índice o sistema funciona igual, só mais lento.

---

## O que porta pro Kubernetes

**Porta inteiro:** imagem OCI com tag imutável; estado desejado declarativo
em git; histórico de builds; página do serviço; botão de promover;
detecção de deriva.

**Muda:** só o executor da Fase 5 e um `kind` a mais no eixo 2.

**O erro que quebraria isso:** o botão "promover" executar o deploy em vez
de commitar. Aí o Monitor fica amarrado ao docker compose e nada porta.
**Promover é escrever no git; aplicar é problema do reconciliador.**

## Armadilhas

- **Disco do worker.** `bag` tem `/var` em 86% (55G livres, medido). Cache
  de build de seis apps Next cresce rápido: `docker builder prune --filter
  until=168h` semanal.
- **Contexto sujo** — resolvido pelo `git worktree`, mas volta se alguém
  "simplificar" pra buildar no checkout.
- **Bootstrap do agente** — ver Fase 2.
- **Serviço novo não é só imagem:** DNS na Cloudflare, `hosts.map`, backend
  no HAProxy **e certificado**. Sem cert a Cloudflare devolve 526 —
  aconteceu com `logs.rcaldas.com`.
- **Gate de qualidade por grep é furada** (medido): no `web.log`, 8 de 22
  linhas casam com `error|warn` e as 8 são ruído de boot do pdfjs; no
  `emailer.log` a linha saudável `❌ Erros: 0` também casa. Health check de
  verdade, não grep.
