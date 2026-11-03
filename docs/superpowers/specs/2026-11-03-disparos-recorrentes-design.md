# Disparos recorrentes de WhatsApp — desenho (03/11/2026)

Reformulação do módulo **Campanhas** (menu Campanhas, módulo `disparos`). Três campanhas que ficam
ligadas e disparam sozinhas, agendamentos pontuais com os modelos de mensagem dentro, visão geral só
com os números, e visual novo nas cores mestre. Ordem de execução pedida pelo dono: **infraestrutura
e regras primeiro, visual por último, teste de ponta a ponta no fim**.

Marcação: **[dono]** = decidido pelo dono na conversa; **[meu]** = decisão minha, pode ser revista;
**[construtor]** = fica para quem implementa.

## 1. Intenção e porquê

Hoje toda campanha é um agendamento manual: alguém precisa criar, escolher público e marcar hora, toda
vez. O dono quer que a loja ligue três campanhas uma vez e o sistema cuide do resto, todos os dias,
com cuidado para não derrubar o número no WhatsApp (bloqueio da Meta) e sem criar carga no banco ou
qualquer coisa em loop. Os modelos de mensagem existem, mas ficam num submenu isolado que ninguém usa.

Sucesso = a loja liga o card, não faz mais nada, e todo dia na hora programada as mensagens saem com
espaçamento aleatório, imagem diferente da véspera, para quem pode receber; a visão geral mostra o que
isso rendeu.

## 2. Metas, não-metas e anti-metas

**Metas**
- Três cards fixos por loja: Recuperação, Nunca compraram, Promoções. Toggle liga/desliga e "pular hoje". **[dono]**
- Galeria de até 5 imagens por card; o disparo rodiza uma imagem por rodada. **[dono]**
- Programação por card (dias da semana + horário) e disparo automático enquanto ligado. **[dono]**
- Público só de quem já trocou mensagem com a loja no WhatsApp. **[dono]**
- Intervalo mínimo de 2 dias entre mensagens para a mesma pessoa. **[dono]** (hoje 3)
- Espaçamento entre mensagens ≥ 1 min, sempre aleatório, nunca o mesmo. **[dono]**
- Checagem "algum card venceu?" a cada 10 min, não a cada minuto. **[dono]**
- Agendamentos continuam como hoje (disparo único, com validade, vai para o histórico) e passam a
  conter os modelos de mensagem. **[dono]**
- Visão geral: linha de cima com Receita gerada, Pedidos, Pessoas impactadas, Pedidos recorrentes,
  Pedidos de clientes recuperados; linha de baixo com Sucesso (%), Taxa de leitura, CTR, Tempo médio
  para pedir; um gráfico único principal; **sem** a lista de campanhas embaixo. **[dono]**
- Visual com as cores `#f6bd28`, `#ea1d2c`, `#112f6b`, `#FFA400`, mantendo a identidade do sistema. **[dono]**

**Não-metas**
- Não mexer no push do app, no robô de atendimento nem nas mensagens automáticas de status de pedido.
- Não criar cron novo (guarda B2 do projeto proíbe duas rotas chamando a mesma função).
- Não importar listas nem mandar para número que nunca falou com a loja.
- Imagens "de bordo" dos cards (ilustração fixa de cada card): o dono manda depois; o construtor deixa
  o espaço e um placeholder neutro.

**Anti-metas (falha mesmo funcionando)**
- Mandar duas vezes para a mesma pessoa no mesmo dia, ou dois cards no mesmo dia para ela.
- Rodada duplicada quando o cron sobrepõe ou o servidor reinicia.
- Consulta pesada a cada minuto (carregar todos os clientes de todas as lojas na memória).
- Card ligado continuar disparando depois de o freio pausar por erro/SAIR.
- Mudar a folha de impressão, o Assistente ou qualquer coisa fora de Campanhas.

## 3. Restrições (do projeto)

- Supabase (Postgres + RLS por `restaurante_id`), Next.js 14 App Router, Coolify com crons HTTP.
- Regras do `CLAUDE.md`: tudo para todas as lojas (gating só pelo Super Admin, chave `disparos`);
  `npm run checar` antes de publicar; ler `docs/CORRECOES-DE-BUGS.md` antes de mexer em retry/cron
  (espera crescente + limite, descartar evento repetido antes do banco, recurso desligado = zero
  consulta, teto por loja); migrations aditivas; nunca converter dado existente; default seguro.
- Hoje (fatos observados):
  - Cron `POST /api/cron/campanhas` a cada 60 s (`app/api/cron/campanhas/route.ts`), `umaPorVez`,
    chama `processarCampanhas` (`lib/mensageria/campanhas-envio.ts:134`).
  - Reserva da fila é a RPC `campanha_reservar_envios` (`supabase/migrations/0190:79-180`): janela
    09:00–21:30, teto diário por loja (`disparo_limite_dia` ≤ `disparo_teto_dia`=150), 1 envio por loja
    por chamada, próxima mensagem da loja em 25–90 s (`0190:167`), frequência por cliente
    `disparo_frequencia_dias`=3 (`0190:12`, `0190:139-149`), expiração 7 dias.
  - Público atual: só quem já pediu (`lib/mensageria/disparo-regras.ts:27-57`,
    `lib/queries/campanhas.ts:198`). Conversas do WhatsApp: `whatsapp_conversas(restaurante_id,
    telefone, ultima_mensagem_em)` (`0103:46`). Opt-out: `whatsapp_descadastros`.
  - Métricas: `campanhas_visao_geral` (0129, janela 72 h) e `campanhas_metricas` (0104, 12 h) — não
    batem entre si.
  - Modelos: tabela `campanha_modelos` (0129), RLS só gestor; pré-preenchem o formulário.
  - Imagem já sai como mídia com legenda (`lib/mensageria/provedor.ts:276`); upload por
    `uploadMidiaCampanha` no bucket `cardapio`, caminho `<restaurante>/campanhas/…`.

## 4. O que fica decidido

### 4.1 Os três cards

| Card | `tipo` | Público (sempre ∩ "conversou com a loja" e ∉ descadastros) |
|---|---|---|
| Recuperação de clientes | `recuperacao` | Já fez pedido e o último pedido foi há **30 dias ou mais** **[meu]** (mesmo corte que a visão geral já usa para "recuperado") |
| Nunca compraram | `nunca_compraram` | Nenhum pedido não cancelado na loja |
| Promoções | `promocoes` | Todo mundo que conversou, comprador ou não **[dono delegou → meu]** |

"Conversou com a loja" = existe linha em `whatsapp_conversas` para (loja, telefone). **[meu]**
Hipótese a confirmar pelo construtor: os avisos de status de pedido criam linha em `whatsapp_conversas`?
Se sim, todo cliente que pediu com WhatsApp conta como "conversou" e o card Recuperação cobre a base
inteira; se não, cobre só quem falou pelo robô/atendimento. Em qualquer caso a regra é a mesma.

Cada card tem: `nome` (fixo, não editável), `mensagem` (texto editável com as variáveis que já existem
— nome do cliente, nome da loja — e link rastreável ligado por padrão), galeria de 0 a 5 imagens,
`dias_semana` (0–6, padrão todos), `hora` (padrão 17:00) e `janela_fim` (padrão 19:00, mesma regra de
mínimo 30 min e teto 21:30), `ativa` (**padrão desligado** — default seguro), `pular_ate` (data).

Rodízio de imagem: o card guarda `imagem_indice`; cada rodada usa `imagens[indice mod n]` e avança.
Sem imagem = mensagem só de texto. **[dono + meu]**

"Pular hoje": grava `pular_ate = hoje (Brasília)`. O card continua ligado; a rodada de hoje é pulada e
`proximo_disparo_em` avança para o próximo dia programado. Amanhã volta sozinho. **[dono]**

Rodapé "Responda SAIR" continua obrigatório (já existe).

### 4.2 Como uma rodada acontece

1. Card ligado tem `proximo_disparo_em` **já calculado e gravado** (ao salvar a programação e ao fim de
   cada rodada). Função SQL pura `campanha_recorrente_proximo(dias_semana, hora, a_partir)` devolve o
   próximo instante em Brasília. Sem cálculo de agenda a cada minuto. **[meu]**
2. Dentro do cron de 60 s, antes de `processarCampanhas`, uma trava em memória
   (`ultimaChecagemCards`) deixa a checagem passar **no máximo a cada 10 min**. Reinício do servidor
   zera a trava: a primeira batida checa de novo, sem efeito colateral (ver passo 3). **[dono + meu]**
3. A checagem é **uma RPC** `campanha_recorrentes_gerar_rodadas()` (security definer, só service_role):
   - `select … from campanha_recorrentes where ativa and proximo_disparo_em <= now() for update skip locked`
     (índice parcial em `proximo_disparo_em where ativa`). Zero vencidos = uma leitura de índice e nada mais.
   - Para cada vencido, na **mesma transação**: avança `proximo_disparo_em` (isso é a trava contra
     rodada dupla: outra chamada não encontra mais o card vencido); se `pular_ate` = hoje, só avança;
     senão cria **uma linha em `campanhas`** (status `agendada`, `agendado_em = now()`,
     `janela_inicio = hora`, `janela_fim`, `tipo_mensagem` imagem/texto, `imagem_url` da vez,
     `recorrente_id` = card, `filtro = {tipo: 'recorrente'}`), popula `campanha_envios` com o público
     por **`insert … select` em SQL** (sem carregar clientes no Node), deduplicado por `telefone_chave`,
     em ordem aleatória (`order by random()`), limitado a `disparo_limite_dia` da loja; grava
     `ultima_rodada_em`, `ultima_campanha_id`, avança `imagem_indice`.
   - Público vazio: não cria campanha; grava `ultima_rodada_motivo = 'sem_publico'` para o card mostrar.
   - Loja com módulo `disparos` desligado no Super Admin: o card nem é lido (`join loja_modulos`),
     seguindo "recurso desligado = zero consulta". **[meu]**
4. Daí em diante é o caminho que já existe: `campanha_reservar_envios` reserva 1 por loja por chamada
   com `skip locked`, respeita janela, teto diário, frequência por cliente, pausa se o WhatsApp cair e
   retoma quando volta, freio de erro/SAIR, retry com espera crescente e limite.
5. **Expiração da rodada**: pendentes de uma rodada recorrente que não saíram até `janela_fim` do dia
   viram `expirado` na próxima reserva (regra nova, só para `recorrente_id is not null`; agendamentos
   continuam expirando em 7 dias). Motivo: amanhã nasce rodada nova com a próxima imagem; não faz
   sentido arrastar a de ontem. **[meu]**
6. **Freio numa rodada** (erro > 5% ou SAIR > 3%): além de pausar a campanha e gerar alerta (já existe),
   **desliga o card** (`ativa = false`, `desligado_motivo = 'freio'`) e o card mostra o aviso. Religar é
   decisão da loja depois de revisar. **[meu]** Sem isso, amanhã repetiria o mesmo problema.
7. **Duas regras mudam para todas as campanhas** (agendadas e recorrentes):
   - `disparo_frequencia_dias`: 3 → **2** (valor em `plataforma_config`, Super Admin segue podendo mudar). **[dono]**
   - Próxima mensagem da loja: 25–90 s → **60–150 s aleatório** (`0190:167`). O intervalo dentro de um lote
     entre lojas diferentes (4–12 s) fica como está: são números diferentes. **[dono + meu]**

Carga por minuto: igual a hoje (uma RPC de reserva) + uma RPC leve a cada 10 min. Nenhuma API paga.

### 4.3 Agendamentos (disparo único) + modelos

- O submenu "Modelos de mensagem" some do menu. `?aba=modelos` redireciona para `?aba=agendamentos`.
- Dentro de Agendamentos: bloco "Modelos" (criar, editar, duplicar, excluir — o que `modelos.tsx` já
  faz) **acima** da lista, e no formulário de novo agendamento o seletor "Usar modelo" (o `usarModelo`
  que já existe). "Salvar como modelo" continua. **[dono + meu]**
- A lista de campanhas com ações (editar, duplicar, destinatários, pausar, retomar, cancelar, excluir)
  que hoje está na aba Campanhas passa para Agendamentos, unificada com a lista que já existe lá
  (Programada para / Enviada em). Rodadas dos cards **não aparecem** nessa lista (são `recorrente_id
  is not null`); aparecem no próprio card como "última rodada". **[meu]**
- Público dos agendamentos: continua "só quem já pediu" como hoje. **[meu]** (Mudar para "conversou"
  encolheria campanhas de lojas que vendem sem WhatsApp; o construtor pode confirmar a hipótese da 4.1.)

### 4.4 Visão geral

- Mantém a RPC `campanhas_visao_geral` (0129). Rodadas dos cards entram sozinhas nas métricas, porque
  são linhas de `campanhas`/`campanha_envios` como as outras.
- Layout: linha de cima com 5 números; linha de baixo com 4 taxas; **um** gráfico principal (receita por
  dia no período, com alternância para pedidos/envios opcional); sem "Receita por campanha" e sem
  tabela embaixo. **[dono]**
- Janela de atribuição: o "ver detalhado" (`campanhas_metricas`, 12 h) passa a usar **72 h**, igual à
  visão geral, para os números pararem de divergir. Mudança de um parâmetro na RPC. **[meu]**

### 4.5 Banco (migration 0245, aditiva)

```
campanha_recorrentes
  id uuid pk, restaurante_id uuid fk, tipo text check in (recuperacao, nunca_compraram, promocoes),
  ativa boolean not null default false, mensagem text not null default '' (≤ 4096),
  incluir_link boolean not null default true,
  imagens jsonb not null default '[]' (array de url, ≤ 5), imagem_indice int not null default 0,
  dias_semana smallint[] not null default '{0,1,2,3,4,5,6}', hora time not null default '17:00',
  janela_fim time not null default '19:00', pular_ate date,
  proximo_disparo_em timestamptz, ultima_rodada_em timestamptz, ultima_campanha_id uuid,
  ultima_rodada_motivo text, desligado_motivo text, criado_em, atualizado_em
  unique (restaurante_id, tipo)
  índice parcial (proximo_disparo_em) where ativa
  RLS: select/update para membros da loja com papel gestor (mesma política de campanha_modelos);
       insert só pela função de criação (as 3 linhas nascem na primeira abertura da tela, desligadas).
campanhas: + recorrente_id uuid fk campanha_recorrentes null; índice (recorrente_id) where not null.
plataforma_config: update disparo_frequencia_dias 3 → 2.
funções: campanha_recorrente_proximo(...), campanha_recorrentes_gerar_rodadas(),
         campanha_reservar_envios (substituída: 60–150 s + expiração de rodada no fim do dia),
         campanhas_metricas (72 h).
grants: tabela nova com grant select/update para authenticated (regra do projeto: sem grant o painel
        abre vazio); funções só service_role, exceto a de criar as 3 linhas (authenticated).
rollback: docs/rollback/0245_*.down.sql (drop das funções novas, volta da reservar da 0190, drop coluna e tabela).
```

Nada é convertido: campanhas e envios existentes seguem iguais.

### 4.6 API

| Rota | Papel | Faz |
|---|---|---|
| `GET /api/admin/campanhas/recorrentes` | gestor | Devolve os 3 cards da loja (cria as 3 linhas se não existem). |
| `PATCH /api/admin/campanhas/recorrentes/[tipo]` | gestor | Atualiza mensagem, imagens, dias, hora, janela, `ativa`, `pular_hoje`. Valida janela (`janelaDoDisparo`), ≤ 5 imagens, variáveis da mensagem (mesma validação da campanha). Recalcula `proximo_disparo_em`. Idempotente. |
| `POST /api/admin/campanhas/recorrentes/[tipo]/imagem` | gestor | Upload (reusa `uploadMidiaCampanha`). |
| `GET /api/admin/campanhas/recorrentes/[tipo]/estimativa` | gestor | Quantas pessoas o público pega hoje (mesma consulta da rodada, só `count`). |

Garçom/atendente: sem acesso (como hoje em `/admin/campanhas` via `lib/acessos.ts`).

### 4.7 Telas (visual por último)

Aba **Campanhas**: três cards grandes, um ao lado do outro (empilhados no celular). Cada card: espaço
da imagem de bordo (placeholder até o dono mandar), nome, descrição de uma linha do público, número
estimado de pessoas hoje, botão **Galeria** (abre gaveta com as até 5 imagens, upload, remover, qual é
a da vez), programação (dias + hora + fim), campo da mensagem com prévia, última rodada (quando, quantos
enviados, ou "sem público", ou "desligado pelo freio"), e embaixo o **toggle** ligado/desligado e o
botão "Pular hoje". Estados: carregando, erro, módulo bloqueado (cadeado "Quero liberar", como os
outros módulos).

Aba **Agendamentos**: bloco Modelos + formulário + lista unificada.

Aba **Visão geral**: 5 + 4 números e um gráfico.

Cores: `#112f6b` (azul profundo: cabeçalhos, números fortes), `#f6bd28` (amarelo: toggle ligado, aba
ativa, hover das ferramentas), `#ea1d2c` (vermelho: desligar, cancelar, freio), `#FFA400` (laranja:
avisos e "a receber"). Radius, fonte Inter e estrutura de cards do painel ficam como estão. Contraste
mínimo 4,5:1 em todo texto (amarelo só com texto escuro `#1F2937`).

### 4.8 Testes e verificação

- Unitários (vitest): `campanha_recorrente_proximo` (semana, virada de dia, horário de Brasília,
  `pular_ate`), rotação de imagem, validação do PATCH, trava de 10 min do cron.
- Migration test `0245_*.test.ts` no padrão do projeto (RLS: usuário de outra loja não lê nem escreve;
  rodada não duplica em duas chamadas concorrentes; público certo para cada tipo; expiração no fim do dia;
  freio desliga o card).
- `scripts/seguranca/e2e-campanhas-metricas.mjs` ganha o caminho recorrente com provedor simulado:
  liga card → rodada criada → envios saem com espaçamento ≥ 60 s (medido com relógio falso) → métrica na
  visão geral → freio desliga o card.
- `npm run checar` limpo; deploy fora do pico; depois conferir na Menuzia com o card ligado em horário
  de teste e **nenhuma loja real com card ligado** (nascem desligados).

## 5. Fica para o construtor

- Nome exato das funções e dos arquivos; onde colocar a trava de 10 min (rota ou `processarCampanhas`).
- Como desenhar o seletor de dias e o relógio (reusar o que o formulário de agendamento já tem).
- Texto padrão da mensagem de cada card (curto, com nome do cliente e link).
- Confirmar a hipótese da 4.1 (status de pedido cria conversa?) e registrar a resposta no README de campanhas.
- Atualizar `docs/campanhas/README.md` (hoje fala em 24 h e 12 h, desatualizado) e `docs/CORRECOES-DE-BUGS.md`
  com a regra nova de cadência.
