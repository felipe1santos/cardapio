# Auditoria: o que está ligado só na Menuzia (12/10/2026)

Levantamento só de leitura: páginas públicas em produção, SELECT no banco de produção e leitura do código (main `28392bf`).
Nada foi alterado.

## Resumo: por que o carrinho e o checkout das lojas antigas parecem "antigos"

**A vitrine nova (sacola, checkout e pagamento no padrão iFood) já está no ar em 9 das 10 lojas.** A chave
`restaurantes.vitrine_nova` está ligada em todas, menos na **firehouse** (ver abaixo). O HTML público de cada loja confirma isso:
`"vitrineNova":true` em 9 lojas, `false` só na firehouse.

O que a Menuzia tem e as outras não tem são **três ajustes por loja que mudam a cara da vitrine nova**:

1. **Fonte "iFood" (Figtree, peso até 600)**: `restaurantes.vitrine_fonte = 'ifood'` **só na Menuzia**. Todas as outras estão em
   `'atual'` (Montserrat, com negrito 700), que é o padrão da coluna. A sacola, o checkout e a tela de pagamento usam a mesma
   fonte da vitrine, então é isso que faz o carrinho das outras lojas "não parecer o padrão novo".
   - Quem decide: `app/loja/[slug]/vitrine.tsx:3302` (classe `vitrine-fonte-ifood` no contêiner) e `:4044` (mesma classe nas
     janelas que abrem em portal: sacola, checkout, ficha), com o CSS em `app/globals.css:85-91`.
   - Valor lido em `lib/queries/cardapio.ts:1139` (`fonteVitrineValida`: qualquer coisa diferente de `'ifood'` vira `'atual'`).
   - Padrão da coluna: `supabase/migrations/0152_vitrine_imagem_fonte.sql:15` (`default 'atual'`).
2. **Tamanho da foto na lista** (`vitrine_imagem_tamanho = 110`) **só na Menuzia**; nas outras é `null`, o que mantém o tamanho
   antigo (120 px, ou 140 px com "imagem grande"). Decide em `app/loja/[slug]/vitrine.tsx:3247`.
3. **Pix online na tela de pagamento**: só aparece na Menuzia, porque é a única com conta do Mercado Pago conectada
   (`pagamentos_contas`). A vitrine pergunta em `app/loja/[slug]/vitrine.tsx:2530-2538` →
   `app/api/loja/[slug]/pix-online/route.ts`. Em produção: Menuzia `{"ativo":true}`, todas as outras `{"ativo":false}`.

Esses dois primeiros ajustes **o próprio dono da loja pode trocar** em Ajustes › Aparência (o seletor só aparece com a vitrine
nova ligada: `app/admin/ajustes/page.tsx:998`). Ninguém trocou nas lojas antigas, então elas ficaram no padrão `'atual'`/`null`.

Menos importantes, mas visíveis:
- **Carrossel de fotos na ficha do item**: só com "Novidades em teste" (`restaurante.novidades`, só Menuzia):
  `app/loja/[slug]/vitrine.tsx:4640`.
- **Cor do tema**: a Menuzia usa uma cor própria (`#f50018`); as outras usam cores da lista (preto, vermelho, azul, rosa).
  Isso é escolha de cada loja, não é chave.

**Firehouse (loja nova, criada em 11/10)** ainda está na vitrine **clássica** inteira (`vitrine-classica.tsx`), porque a
`vitrine_nova` tem padrão `false` (`0152_vitrine_imagem_fonte.sql:24`) e foi ligada à mão nas lojas que existiam em 08/10.
**Toda loja nova nasce com a vitrine antiga.** Decide em `app/loja/[slug]/page.tsx:146`.

Não é cache: o service worker da vitrine (`public/sw-loja.js`) não guarda nada nem intercepta requisições (só push), e o do
painel (`public/sw.js`) também não faz cache. As 10 páginas vêm com o mesmo conjunto de arquivos JS.

## Tabela: melhorias ligadas só na Menuzia (ou em poucas lojas)

Lojas: menuzia, ponto-400-hamburgueria, mama-pizza, estancia-burger, pizza-do-rosa, villa-lanches, nossa-cozinha, db-doces,
w-lanches-reviver, firehouse (10 no total).

| # | Melhoria | Onde está ligada | Por que não está nas outras | Risco de liberar | Recomendação |
|---|---|---|---|---|---|
| 1 | Fonte iFood na vitrine (`vitrine_fonte='ifood'`): sacola/checkout/pagamento com a cara nova | Só Menuzia | Padrão da coluna é `'atual'`; ninguém trocou em Ajustes nas outras | Baixo (só visual; o dono da loja pode voltar em Ajustes) | Agora, se o dono quiser o padrão novo em todas |
| 2 | Tamanho da foto na lista (90/100/110) | Só Menuzia (110) | Padrão `null` = tamanho antigo (120/140) | Baixo (só visual) | Agora, junto com o item 1 (escolher um tamanho por loja ou o mesmo para todas) |
| 3 | Vitrine nova (`vitrine_nova`) | 9 lojas; **falta firehouse** | Padrão `false`; a firehouse nasceu depois da ligação em massa de 08/10 | Baixo (as outras 9 já usam há 4 dias) | Agora na firehouse; depois, decidir se loja nova já nasce com ela (mudar padrão da coluna) |
| 4 | "Novidades em teste" (`novidades_teste`): menu reorganizado e escuro, fotos até 4 + carrossel na vitrine, Links para divulgar, selo de origem Direto/Sem origem, Vendas por origem no Dashboard, Impressão dentro de Ajustes, Modelos e Notificações em Campanhas, Agente em Ajustes | Só Menuzia | Chave de teste (0178); ligada à mão; o Super Admin tem "liberar para todas" | Médio (muda menu e onde ficam as telas para todos os funcionários; a vitrine ganha o carrossel) | Depois, uma loja por vez, avisando o dono da loja da mudança de menu |
| 5 | Pix online (Mercado Pago) no checkout | Só Menuzia | `pix_online_ativo` já é `true` em todas, mas só a Menuzia tem conta do MP conectada (`pagamentos_contas`) | Médio (mexe com dinheiro; cada loja precisa conectar a própria conta) | Depois, só com a loja conectando a conta dela. Não liberar sem configuração |
| 6 | Notificações push para clientes (app do cardápio) | Só Menuzia (`push_liberado`) | Liberado à mão; sem tela para ligar | Médio (envio automático para clientes; precisa de limites por loja em `push_config`, só a Menuzia tem linha) | Depois, uma loja por vez |
| 7 | Agente de IA no WhatsApp (`loja_modulos.agente_ia` + `whatsapp_robo_config.ia_ativo`) | Só Menuzia (teto US$ 0,50/dia) | Módulo pago; liberado no Super Admin | Alto (custo por resposta; regra de custo do projeto) | Depois, só com módulo contratado e teto diário configurado. Não liberar sem configuração |
| 8 | Módulo Financeiro (`loja_modulos.financeiro`) | Só Menuzia. `financeiro_ativo` está `true` em 9 lojas, mas o módulo bloqueado anula (`app/api/sessao/estado/route.ts:24`) | Módulo pago (0176) | Médio (muda a rotina de caixa) | Depois, conforme contratação |
| 9 | Controle de caixa nível 2 (`controle_caixa_ativo`) | Nenhuma loja (nem a Menuzia) | Falta gerente com PIN nas lojas | Alto (pode travar tela/caixa) | Depois |
| 10 | Disparos (campanhas) (`loja_modulos.disparos`) | Nenhuma (a Menuzia foi bloqueada pelo dono em 10/10) | Módulo pago | Médio (WhatsApp em massa) | Depois, só por ordem do dono |
| 11 | Despacho automático de entregas (`despacho_automatico`) | Só Menuzia | Cada loja liga no painel; ninguém ligou | Médio (atribui entregas sozinho) | Depois, se a loja pedir |
| 12 | Agendamento de pedidos (`agendamento_ativo`) | Só Menuzia | Configuração da própria loja (padrão desligado) | Baixo para a vitrine, médio para a operação (pedido para depois) | Depois, por pedido da loja |
| 13 | PDV v2 (`pdv_v2`) | 6 lojas: menuzia, estancia-burger, mama-pizza, pizza-do-rosa, ponto-400, villa-lanches. Fora: db-doces, nossa-cozinha, w-lanches-reviver, firehouse | Ligado à mão por loja (sem tela) | Médio (muda o fluxo do balcão/caixa) | Depois, avisando a loja |
| 14 | Mesas e comandas (`modulo_mesas_ativo`) | 4 lojas: menuzia, pizza-do-rosa, ponto-400, villa-lanches | Configuração da loja (só quem atende mesa) | Baixo (só quem usa salão) | Não precisa liberar; é por loja |
| 15 | Robô de atendimento novo (`whatsapp_robo_config.autoatendimento_ativo`) | Ligado em 7 lojas com linha (todas menos nossa-cozinha, que o dono desligou); firehouse e w-lanches sem linha (padrão ligado ao abrir a tela). Chave Pix do robô só na Menuzia e Estância | Precisa de WhatsApp conectado: só menuzia, ponto-400, estancia, villa, nossa-cozinha têm instância | Médio (responde clientes reais) | Já está; falta só WhatsApp nas lojas sem instância |
| 16 | Impressão nova (`impressao_somente_nova`) | 9 lojas; falta firehouse | Loja nova nasce com padrão `false` | Baixo | Agora na firehouse, se ela já imprime |
| 17 | Integração Nexta | Só Menuzia, e desligada (`nexta_config.ativo=false`) | Falta registrar webhook com o suporte | — | Depois |
| 18 | Dashboard mostra pedidos de teste (`LOJAS_DE_TESTE`) | Só Menuzia (`lib/dashboard-limpeza.ts:8`) | De propósito: é a loja de teste | — | Manter |

## Como conferi

**Páginas públicas** (curl com user-agent de iPhone, sem login), uma por loja, `https://app.menuzia.com.br/loja/<slug>`:
- Mesmo conjunto de JS (hash da lista de chunks igual nas 10).
- No payload da página: `"vitrineNova":true` em 9, `false` na firehouse; `"novidades":true` só na Menuzia;
  `data-fonte-vitrine="ifood"` e classe `vitrine-fonte-ifood` só na Menuzia (as outras `"atual"`; firehouse sem o atributo, por
  ser a clássica); `"imagemTamanho":110` só na Menuzia (outras `null`).
- `GET /api/loja/<slug>/pix-online`: `ativo:true` só na Menuzia. `GET /api/loja/<slug>/push/config`: `ativo:true` só na Menuzia.

**Banco de produção (só SELECT):**
```sql
select column_name, column_default from information_schema.columns
 where table_schema='public' and table_name='restaurantes' and data_type='boolean';
select slug, vitrine_nova, novidades_teste, pdv_v2, financeiro_ativo, controle_caixa_ativo, pix_online_ativo,
       push_liberado, modulo_mesas_ativo, impressao_beta_liberado, impressao_somente_nova, despacho_automatico,
       entrega_sem_entregador, agendamento_ativo, layout_cardapio, usa_logistica from restaurantes order by slug;
select slug, vitrine_imagem_tamanho, vitrine_fonte, cor_tema, imagem_grande, aceita_retirada, status_loja from restaurantes;
select slug, criado_em, evolution_instance is not null from restaurantes order by criado_em;
select r.slug, m.modulo, m.liberado from loja_modulos m join restaurantes r on r.id=m.restaurante_id;
select r.slug, w.robo_ativo, w.autoatendimento_ativo, w.ia_ativo, w.ia_teto_usd_dia, w.pix_chave is not null
  from whatsapp_robo_config w join restaurantes r on r.id=w.restaurante_id;
select r.slug, p.provedor, p.status from pagamentos_contas p join restaurantes r on r.id=p.restaurante_id;
select r.slug from push_config p join restaurantes r on r.id=p.restaurante_id;   -- e o mesmo para fin_config, nexta_config
```

**Código (main `28392bf`):**
- `app/loja/[slug]/page.tsx:146`: vitrine nova x clássica (`vitrine_nova`).
- `app/loja/[slug]/vitrine.tsx:3247` (tamanho da foto), `:3302` e `:4044` (fonte iFood), `:2530-2538` (Pix online), `:4640` (carrossel com novidades).
- `app/globals.css:85-91`: CSS da fonte iFood.
- `lib/queries/cardapio.ts:1133-1142` e `:1217-1257`: leitura das colunas da vitrine.
- `supabase/migrations/0152_vitrine_imagem_fonte.sql:15,24`: padrões `'atual'` e `false`.
- `app/admin/ajustes/page.tsx:998`: seletor de tamanho/fonte só com vitrine nova.
- `app/api/sessao/estado/route.ts:16-40`: novidades, financeiro e módulos no painel.
- `app/superadmin/actions.ts:181-229`: ligar/desligar novidades por loja e para todas.
- `lib/modulos.ts`: módulos pagos (`moduloLiberado`).
- `public/sw-loja.js`, `public/sw.js`: sem cache.
- Busca por gates fixos por loja (`slug === 'menuzia'`, id da Menuzia): só `lib/dashboard-limpeza.ts:8` e o alerta de custo
  (`lib/custo/alerta-whatsapp.ts:20`, que usa o WhatsApp da Menuzia para avisar o dono); nenhum na vitrine.
