# Varredura de custo, carga e risco — 28/10/2026

Relatório vivo (se o terminal fechar, continuar daqui). Pasta: `C:\projetos\cardapio-estab-main` (main).
`cardapio-estab` estava em `feat/pdv-visual` com 457 arquivos alterados de outra sessão — não foi tocada.
Outra sessão publica KDS/dashboard em main ao mesmo tempo: sempre `git pull --rebase` antes do push.

Medição: `pg_stat_statements` (delta por janela, somando por `queryid` — o mesmo id aparece uma vez por papel;
somar só por id comparava linhas diferentes e gerou um falso "laço de 270 mil/min" no começo desta sessão).
Scripts no scratchpad da sessão (`foto.mjs`, `delta.mjs`, `vigia.mjs`).

## Etapa 1 — o que pode derrubar ou cobrar

### Situação (28/10 ~18h BRT)
| Item | Número |
|---|---|
| Plano | **Pro** desde 28/10 (ciclo 28/10–28/11), sem cobrança de excedente (teto de gasto ligado) |
| Egress do ciclo | 0,033 / 250 GB em ~3 h → projeção ~8 GB/mês (3%) |
| Requisições PostgREST | ~510/min no pico do jantar; média 26/10→28/10: 237/min (~340 mil/dia) |
| Realtime | pico 4 conexões / 500; 12 mensagens |
| Log ingestion | 0,033 / 20 GB |
| Disco do banco | 2 GB provisionado / 8 GB incluídos |
| Storage | 0,38 / 100 GB |
| VPS | 2 vCPU, 8 GB, swap 4 GB (1 GB usado), disco 48%; app 8% CPU / 292 MB |

Conclusão: o bloqueio de 27/10 (402 `exceed_egress_quota`) não volta neste ciclo. O prazo "10/11" deixou de existir.
O volume de requisições é o mesmo de antes das correções de 26/10 nos horários de pico — as correções
cortaram o desperdício, o resto é uso real (sessão, alarme, Assistente).

### Achados
| # | Achado | Gravidade | Causa | Correção | Antes → depois |
|---|---|---|---|---|---|
| 1.1 | Nenhum laço ativo | — | — | — | — |
| 1.2 | Maiores fontes restantes no pico: sessão (`usuarios` 43/min + Auth `getUser` 53/min), Assistente conferindo "ainda é o dono da Cozinha" a cada volta da espera (`restaurantes` 29+17/min) | baixa (com Pro) | leitura repetida de dado que quase não muda | — | — |
| 1.3 | `/` da VPS montado com `discard` (TRIM síncrono travou o disco em 22/10) | média | opção de montagem | pedir ok ao dono (mudança no servidor) | — |
| 1.4 | 25,5 GB de imagens Docker + 10 GB de cache de build recuperáveis | baixa | builds antigos | limpeza agendada (ver Etapa 7: alerta de disco) | — |
| 1.5 | **Causa provável do bloqueio de 27/10**: enxurrada de eventos de conexão do WhatsApp da Ponto 400 (69.884 "connecting" + 669 "close" em 16h–18h, ~620/min) | **alta** | ~5 consultas por evento + reconexão automática em 440 (sessão em outro lugar) fazendo pingue-pongue | evento repetido em 60 s descartado sem consulta; sem reconexão em 440/401; máx. 3 reconexões/h por loja (BUGS-CONHECIDOS) | ~375 mil req em 2 h → evento repetido custa 0 consultas (teste: 51 eventos iguais = 1 processado, 0 consultas extras) |

## Etapa 2 — banco de dados

Banco: 138 MB de 8 GB (Pro). Maiores: `eventos_auditoria` 45 MB (80 mil linhas; ~10,8 mil/dia, 98% era `whatsapp.conexao`
da enxurrada), `whatsapp_eventos` 29 MB (~11,7 mil/dia), `vitrine_eventos` 8,6 MB (~570/dia).

| # | Achado | Gravidade | Proposta (não aplicada — pede ok do dono) |
|---|---|---|---|
| 2.1 | `eventos_auditoria` sem limpeza; ~70 mil linhas técnicas `whatsapp.conexao` | média | apagar só `whatsapp.conexao` com mais de 30 dias (é registro técnico; o resto da auditoria fica) |
| 2.2 | `whatsapp_eventos` (metadado de webhook) sem limpeza | média | 90 dias |
| 2.3 | `vitrine_eventos` (métricas da vitrine) sem limpeza | baixa | 13 meses (comparação ano a ano) — é dado de negócio |
| 2.4 | `impressao_trabalhos`, `api_alertas`, `push_envios`, `fin_alertas` sem limpeza | baixa | 180 dias |
| 2.5 | `sistema_*` (novas) | — | limpeza automática já incluída (fotos 30 d, alertas 180 d) |

Sem índice faltando relevante: 0225 cobriu as consultas quentes; `pedidos` 424 mil idx_scan vs 6,5 mil seq_scan.

## Etapa 3 — imagens

| # | Achado | Correção | Antes → depois |
|---|---|---|---|
| 3.1 | Pizza do Rosa: PNGs pesados | já convertidos em 22/10 (cb9d1327) | 106 → 11,7 MB (todas as lojas) |
| 3.2 | 60 itens com foto e sem miniatura (49 na Villa): a lista baixava a foto de até 1200 px | `scripts/imagens/gerar-miniaturas.mjs --aplicar` (57 gravadas; 3 já eram pequenas). Desfazer: `--desfazer ~/menuzia-backups/miniaturas-2026-10-28-21-23.json` | lista: 2.426 KB → 880 KB (−64%) |
| 3.3 | Upload do painel | já converte e redimensiona no navegador (lib/imagem.ts: WebP, perfis 400/1200/1600 px) e gera par foto+miniatura | — |

## Etapa 4 — cache no navegador (medido em produção)

- JS/CSS (`/_next/static`): `public, max-age=31536000, immutable` (nome com hash). Fontes: idem.
- Fotos e vídeos do Storage: `public, max-age=31536000` + CDN (CF HIT); nome único por upload (uuid, `upsert: false`)
  → trocar a foto cria URL nova. (O `HEAD` responde `private, no-cache`, o `GET` real responde o cabeçalho certo.)
- HTML da vitrine: `no-store` — leva loja aberta/fechada e preços sempre frescos; o cardápio carrega no navegador a cada
  abertura. Decisão: **não** guardar preço/disponibilidade no navegador agora — o ganho seria ~35 KB por visita e o risco
  (preço velho) é o que o dono proibiu; o grosso (fotos, JS) já não é baixado de novo por quem volta.

## Etapa 6 — travas

| Trava | Por quê |
|---|---|
| POST do pedido da vitrine: 15/min por IP, 200/min por loja | rota pública sem login; robô em laço criaria pedidos falsos, tocaria alarme e imprimiria em todas as lojas |
| Teto por loja no Maps (geocoding/directions/places): 60% do limite do sistema (0230) | uma loja em laço com endereços diferentes escapa da trava de disparo e gastava a cota de todas |
| `umaPorVez` em entregas e Pix | duas rodadas ao mesmo tempo despachariam/consultariam em dobro |
| Batida de todos os crons (`sistema_cron_batidas`) | cron parado no Coolify passava despercebido |
| Evento de conexão repetido / reconexão limitada | ver 1.5 |
| Já existiam: idempotência do pedido (chave por checkout + índice único 0065), teto de IA/áudio por loja em US$, limite de vídeo 20/h por loja, 50 MB/15 s no vídeo | — |

## Etapa 7 — vigia + alertas

`lib/saude/` (0229): dentro do cron do WhatsApp, a cada 5 min (trava = última foto no banco), ~8 consultas leves, nenhuma
API paga. Mede: requisições/min (pg_stat_statements) × média 7 dias, egress projetado no mês, tamanho do banco, APIs
pagas do dia (total e por loja), IA em US$, CPU/memória/disco da VPS, crons parados, WhatsApp de loja caído, e o próprio
bloqueio do Supabase (402). Amarelo 70% / 2×; vermelho 90% / 4×. Mesmo assunto: 1 a cada 6 h (WhatsApp de loja: 24 h);
amarelo→vermelho sai na hora. Resumo às 09:00. Envio: `ALERTAS_WHATSAPP_INSTANCIA` (senão a instância da Menuzia) →
`ALERTAS_WHATSAPP_NUMERO` (senão o número do suporte, o mesmo do alerta de custo de 10/10); falhou → push no painel da
Menuzia. Tela: Super Admin › Saúde do sistema. Teste: `POST /api/cron/saude` com `x-cron-secret`.
