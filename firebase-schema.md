# Firebase Schema — RepoApp

Documentação da estrutura do Realtime Database (RTDB) e das regras de segurança.

---

## Visão geral dos nós

```
/
├── tarefas/           — Tarefas do dia (picking e palete)
├── operadores/        — Operadores online (presença em tempo real)
├── opCamFiltros/      — Filtros de câmara por operador
├── logs/              — Log de ações por dia
├── roles/             — Papéis e nomes dos usuários
├── pendingUsers/      — Usuários aguardando aprovação do admin
└── preRoles/          — Pré-atribuição de papel por e-mail (legado)
```

> Nós `carregamentos`, `manobristas` e `nomesManobristas` existem nas regras por legado (papéis Expedição/Manobrista removidos do front-end). Ignorar.

---

## `/tarefas/{pushId}`

Cada tarefa criada pelo repositor. O `pushId` é gerado pelo Firebase (`push()`).

| Campo | Tipo | Obrigatório | Descrição |
|-------|------|-------------|-----------|
| `endereco` | string | ✓ | Endereço no formato `X NN NNN NN` (ex: `B 01 001 01`) |
| `tipo` | string | ✓ | `"picking"` ou `"palete"` |
| `status` | string | ✓ | `"pendente"` → `"andamento"` → `"concluido"` \| `"vazio"` \| `"pulado"` |
| `ts` | number | ✓ | Timestamp Unix (ms) de criação |
| `atribId` | string\|null | — | UID do operador atribuído (null = qualquer) |
| `atribNome` | string\|null | — | Nome do operador atribuído (desnormalizado para display) |
| `opId` | string\|null | — | UID do operador que pegou/concluiu |
| `opNome` | string\|null | — | Nome do operador que pegou/concluiu |
| `urgente` | boolean\|null | — | `true` se marcada como urgente; `null` para remover |
| `alertaVisto` | boolean | — | `true` quando o repositor dispensou o alerta de endereço vazio |

**Fluxo de status**:
```
pendente → andamento → concluido
                    ↘ vazio
         → pulado (pode voltar a pendente implicitamente ao reenviar)
```

**Quem escreve**:
- Repositor: cria, remove, altera qualquer campo, marca urgente
- Operador: só pode alterar `status` (para `andamento`, `concluido`, `vazio`, `pulado`), `opId`, `opNome` e `alertaVisto` — não pode mudar `endereco`, `tipo`, `atribId`, `atribNome`

**Regra de validação** do endereço: `/^[A-F]\s+\d{2,3}\s+\d{3,4}\s+\d{2}$/`

---

## `/operadores/{uid}`

Presença em tempo real dos operadores online. O nó é criado no login do operador e removido via `onDisconnect().remove()` na desconexão.

| Campo | Tipo | Obrigatório | Descrição |
|-------|------|-------------|-----------|
| `nome` | string | ✓ | Nome de exibição (1–30 chars) |
| `uid` | string | ✓ | UID Firebase do operador (igual à chave do nó) |
| `ts` | number | ✓ | Timestamp do login (ms) |
| `pausa` | boolean\|null | — | `true` quando operador está em pausa; `null` quando retoma |

**Importante**: `registrarOperador()` usa `set()` (sobrescreve o nó inteiro), então `pausa` é sempre `null` após reconexão — comportamento intencional.

**Quem escreve**:
- Operador: escreve/remove o próprio nó; pode atualizar `pausa`
- Repositor: pode renomear (escreve apenas em `operadores/{uid}/nome`)

**⚠ Regra RTDB atual** não lista `pausa` na validação do nó — mas é permitida porque a validação não usa exclusão de campos extras. Se a regra for apertada, adicionar:
```json
"(!newData.child('pausa').exists() || newData.child('pausa').isBoolean() || newData.child('pausa').val() === null)"
```

---

## `/opCamFiltros/{uid}`

Filtro de câmaras aceitas por operador. Escrito pelo repositor; lido pelo operador e pelo repositor.

```json
{
  "uid-do-operador": {
    "A": true,
    "B": true
  }
}
```

- Ausência do nó = operador aceita todas as câmaras
- Nó `null` = idem (sem restrição)
- Presença de chaves = operador só recebe tarefas das câmaras listadas

**Quem escreve**: somente repositor.

---

## `/logs/{YYYY-MM-DD}/{pushId}`

Log de ações do dia. Cada entrada é criada por `addLog()` e nunca é modificada.

| Campo | Tipo | Descrição |
|-------|------|-----------|
| `ts` | number | Timestamp da ação (ms) |
| `acao` | string | Ver tabela abaixo |
| `tarefaId` | string\|null | pushId da tarefa envolvida |
| `endereco` | string\|null | Endereço da tarefa |
| `tipo` | string\|null | `"picking"` ou `"palete"` |
| `opId` | string\|null | UID de quem executou a ação |
| `opNome` | string\|null | Nome de quem executou a ação |

**Tipos de ação (`acao`)**:

| Valor | Quem gera | Descrição |
|-------|-----------|-----------|
| `enviou` | Repositor | Nova tarefa enviada |
| `pegou` | Operador | Tarefa colocada em andamento |
| `concluiu` | Operador | Tarefa concluída |
| `vazio` | Operador | Endereço marcado como vazio |
| `pulou` | Operador | Tarefa pulada |
| `urgente_on` | Repositor | Urgência ativada |
| `urgente_off` | Repositor | Urgência removida |

**⚠ PROBLEMA CRÍTICO**: o nó `logs/` **não tem regra** no `firebase.database.rules.json` atual. A regra raiz é `.write: false`, então todas as escritas de `addLog()` falham silenciosamente.

**Adicionar ao `firebase.database.rules.json`** (dentro de `"rules": {`):
```json
"logs": {
  "$date": {
    ".read": "auth != null && root.child('roles/' + auth.uid + '/role').val() === 'repositor'",
    ".write": "auth != null && (root.child('roles/' + auth.uid + '/role').val() === 'repositor' || root.child('roles/' + auth.uid + '/role').val() === 'operador')"
  }
}
```
Após adicionar: `firebase deploy --only database`

---

## `/roles/{uid}`

Papel permanente de cada usuário. Escrito pelo admin; lido pelo próprio usuário e pelo admin.

| Campo | Tipo | Descrição |
|-------|------|-----------|
| `role` | string | `"repositor"`, `"operador"` ou `"admin"` |
| `name` | string | Nome de exibição (1–50 chars) |

---

## `/pendingUsers/{uid}`

Usuários que fizeram login mas ainda não têm papel atribuído.

| Campo | Tipo | Descrição |
|-------|------|-----------|
| `email` | string | E-mail do usuário |
| `ts` | number | Timestamp do primeiro login |

O admin libera ou rejeita. Ao liberar: cria entrada em `roles/` e remove de `pendingUsers/`.

---

## Regras — resumo de permissões

| Nó | Repositor | Operador | Admin |
|----|-----------|----------|-------|
| `tarefas` | lê + escreve tudo | lê + escreve status/opId/opNome | — |
| `operadores` | lê; escreve só `nome` | lê; escreve próprio nó | — |
| `opCamFiltros` | lê + escreve | lê | — |
| `logs` | lê + escreve | escreve | — |
| `roles` | — | — | lê + escreve |
| `pendingUsers` | — | lê próprio | lê + escreve |
| `preRoles` | — | — | lê + escreve |

---

## Deploy das regras

```bash
firebase deploy --only database
```

Testar antes com o simulador no Firebase Console → Realtime Database → Regras → Simular.
