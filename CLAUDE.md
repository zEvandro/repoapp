# CLAUDE.md — RepoApp

Guia de referência para desenvolvimento e manutenção do sistema. Leia antes de fazer qualquer alteração.

---

## O que é o sistema

**RepoApp** é um sistema PWA de gerenciamento de picking em tempo real para armazém frigorífico. O repositor (supervisor) envia tarefas de reposição; os operadores as executam nos corredores das câmaras.

---

## Stack

| Camada | Tecnologia |
|--------|-----------|
| Frontend | HTML/CSS/JS vanilla, sem bundler |
| Banco de dados | Firebase Realtime Database (RTDB) |
| Autenticação | Firebase Auth (email + senha) |
| Hospedagem | Arquivo estático (sem build step) |
| PWA | `manifest.json` + Service Worker externo |

**Firebase SDK**: versão 10.8.0 carregada via CDN (`gstatic.com`). Usar ESModules (`type="module"`).

---

## Estrutura de arquivos

```
index.html               — SPA principal (~1400 linhas), toda a lógica JS aqui
firebase-config.js       — Credenciais do Firebase (NÃO commitar segredos reais)
firebase.json            — Aponta para firebase.database.rules.json
firebase.database.rules.json — Regras de segurança do RTDB
manifest.json            — Manifesto PWA
icon.png                 — Ícone do app

css/
  00-tokens.css          — Variáveis CSS (cores, tipografia, espaçamentos)
  01-base.css            — Reset e estilos globais
  02-layout.css          — Grid e estrutura de páginas
  03-components.css      — Componentes compartilhados (cards, botões, modais)
  04-repositor.css       — Estilos específicos da tela do repositor
  05-operador.css        — Estilos específicos da tela do operador
  06-admin.css           — Estilos específicos da tela do admin
  99-overrides.css       — Overrides do tema corporativo (aplica por último)

scripts/
  provision-auth-roles.mjs — Script Node.js para provisionar usuários em lote via service account
```

---

## Papéis (roles)

| Role | Descrição |
|------|-----------|
| `repositor` | Supervisor — envia tarefas, monitora fila e histórico |
| `operador` | Executa picking/palete nas câmaras |
| `admin` | Gerencia usuários, libera acessos, atribui papéis |

> Papéis `expedicao` e `manobrista` estão nas regras RTDB por legado mas **não estão implementados no front-end**. Ignorar.

---

## Câmaras

Definidas no objeto `CAMARAS` em `index.html` (~linha 130). Cada entrada tem `nome`, `cor`, `bg`, `bd`. A câmara **F** tem `especial: true` (aceita endereços de chão "picking de chão").

```js
const CAMARAS = {
  B: { nome:"Batavo",      cor:"#5b8dd9", ... },
  A: { nome:"Itambé",      cor:"#c96060", ... },
  E: { nome:"DPA",         cor:"#8b6bc8", ... },
  C: { nome:"Área Seca",   cor:"#c4952a", ... },
  D: { nome:"Área Seca 2", cor:"#c47a38", ... },
  F: { nome:"Câmara F",    cor:"#4ca870", ..., especial:true },
};
```

**Adicionar uma câmara**: editar `CAMARAS` e o `chipNome` em `camChipsHTML()`.

---

## Estado global (variáveis em `index.html`)

| Variável | Tipo | Descrição |
|----------|------|-----------|
| `perfil` | string\|null | Role do usuário logado: `"repositor"`, `"operador"`, `"admin"` |
| `nomeOperador` | string\|null | Nome do operador logado |
| `opId` | string\|null | UID Firebase do operador logado |
| `tarefas` | array | Lista de tarefas do dia (de `onValue` em `tarefas/`) |
| `operadores` | object | Mapa `{uid: {nome, ts, pausa}}` dos operadores online |
| `tipoAtual` | string | Tipo de tarefa selecionado para envio: `"picking"` ou `"palete"` |
| `atribPara` | string\|null | UID do operador selecionado para atribuição (null = qualquer) |
| `camaraAtual` | string | Câmara ativa no painel do repositor (letra A–F) |
| `meuFiltroCamera` | array\|null | Câmaras que o operador logado aceita (null = todas) |
| `filtroHistorico` | string | Texto de busca no histórico do repositor |
| `filtroRua` | string | Filtro de rua ativo na tela do operador |

---

## Funções principais

### Render
- `render()` — dispatcher: chama `renderLogin()`, `renderRepositor()`, `renderOperador()` ou `renderAdmin()` conforme `perfil`
- Cada render reconstrói o `innerHTML` de `#app` inteiro — não há re-render parcial

### Firebase listeners
- `bindDataByPerfil()` — configura todos os `onValue` listeners após login. Também inicia `bindConnIndicator()`
- `clearDataSubs()` — cancela todos os listeners (chamado no logout)

### Autenticação
- `aplicarPapel(role, name)` — chamado quando o listener de auth confirma o papel; inicia `bindDataByPerfil()`
- `limparSessaoDados()` — reset completo do estado no logout

### Presença de operador
- `registrarOperador()` — `set()` em `operadores/{opId}` + configura `onDisconnect().remove()`
- `removerOperador()` — `remove()` de `operadores/{opId}`
- O `set()` em `registrarOperador` **sobrescreve o nó inteiro**, então o campo `pausa` é resetado automaticamente no login

### Ações de tarefa
Todas em `window.*` para serem chamadas via `onclick` inline:
- `window.enviar()` — valida endereço e chama `doPush()`
- `window.acao(id, status)` — atualiza status de uma tarefa + grava log
- `window.pular(id)` — marca como `pulado` + grava log
- `window.toggleUrgente(id)` — alterna flag `urgente` + grava log
- `window.togglePausa()` — alterna campo `pausa` em `operadores/{opId}`
- `window.novoDia()` — abre modal de relatório do dia e executa limpeza

### Logs
- `addLog(acao, tarefaId, endereco, tipo)` — grava em `logs/YYYY-MM-DD/{pushId}`
- `window.verLog()` — lê `logs/hoje` via `get()` (one-shot) e exibe modal

### Utilitários
- `h(v)` — escapa HTML (usar sempre para saída de dados do usuário)
- `sq(v)` — escapa aspas simples para uso em atributos `onclick='...'`
- `idSafe(v)` — converte string para id CSS seguro
- `dataHoje()` — retorna `YYYY-MM-DD` da data local
- `fmtHora(ts)` — formata timestamp em `HH:MM`
- `tempoFila(ts)` / `corTempo(ts)` — tempo na fila e cor do indicador

---

## CSS — sistema de tema

O tema corporativo é aplicado **exclusivamente via `99-overrides.css`**. Os outros arquivos CSS definem a base; os overrides sobrescrevem com `!important` quando necessário.

**Tokens principais** (em `00-tokens.css`):
- `--corp-bg`, `--corp-header`, `--corp-surface` — fundos
- `--corp-text`, `--corp-muted` — cores de texto
- `--corp-primary`, `--corp-border` — destaque e separadores
- `--addr-size`, `--addr-sp` — tamanho do endereço (controlado por JS via `applyFont()`)

**Regra**: nunca editar `03-components.css` para ajustes visuais de tema. Sempre usar `99-overrides.css`.

---

## Adicionando uma nova feature

1. **Novo campo em tarefa**: adicionar o campo no `doPush()`, na regra `.validate` do `tarefas/$id` em `firebase.database.rules.json`, e tratar no `cardRep()` e/ou `cardOp()`
2. **Nova ação de operador**: criar `window.minhaAcao()`, chamar `addLog()` no final, adicionar botão no `cardOp()`
3. **Novo nó Firebase**: adicionar a regra em `firebase.database.rules.json` e fazer deploy com `firebase deploy --only database`
4. **Novo ícone**: adicionar SVG no objeto `I` (~linha 53)
5. **Novo estilo de tema**: adicionar em `99-overrides.css`

---

## Gotchas importantes

- **`h()` é obrigatório** para qualquer dado do usuário renderizado como HTML. Nunca interpolar diretamente.
- **`sq()` é obrigatório** para strings dentro de `onclick='...'` com aspas simples.
- **`onValue` do `operadoresRef`** chama `render()` tanto para repositor quanto para operador — necessário para que mudanças de pausa reflitam em tempo real na tela do operador.
- **`registrarOperador()` usa `set()` (não `update()`)**— sobrescreve o nó inteiro. Qualquer campo novo em `operadores/{opId}` que deva persistir entre reconexões precisaria ser lido antes e incluído no `set()`.
- **Regras RTDB**: o campo `pausa` em `operadores/$key` é permitido pelo RTDB porque a validação não usa `hasChildren` exclusivo — mas se a regra for apertada no futuro, adicionar `pausa` ao `.validate`.
- **`logs/` não tem regra** no `firebase.database.rules.json` atual — as escritas de `addLog()` falham silenciosamente. Ver `firebase-schema.md` para a regra a adicionar.
- **Firebase config** está em `firebase-config.js` como `window.FIREBASE_CONFIG`. Esse arquivo não está no git (`.gitignore`). Nunca hardcodar no `index.html`.

---

## Deploy

```bash
# Apenas regras do banco
firebase deploy --only database

# Apenas hosting (se configurado)
firebase deploy --only hosting
```

O front-end não tem build step — editar os arquivos e fazer deploy diretamente.

---

## Versionamento

`APP_VERSION` em `index.html` linha ~37. Incrementar a cada commit com mudança visível.  
Formato: `v{major}.{minor}` — ex: `v3.53`.
