# Correções de bug — para não repetir

Lista viva. Cada item: o que aconteceu, por quê, o que foi feito, como evitar e o teste que segura. Bugs com checagem
automática no build ficam também em [BUGS-CONHECIDOS.md](BUGS-CONHECIDOS.md) (B1–B6).
Relatórios completos: [varredura 28/10](relatorios/2026-10-28-varredura.md) · [auditoria das travas 28/10](relatorios/2026-10-28-auditoria-travas.md).

## 28–29/10/2026 — varredura de custo, travas e WhatsApp

### Produção / dinheiro

| # | Bug | Causa | Correção | Como evitar | Teste |
|---|---|---|---|---|---|
| 1 | **Supabase bloqueou o sistema todo (402) em 27/10** | Enxurrada de ~75 mil eventos de conexão do WhatsApp da Ponto 400 em 2 h, ~5 consultas cada, num mês já com egress em 286% do plano grátis | Plano Pro; freio nos eventos (item 2); vigia com alerta | Todo evento externo repetitivo (webhook) precisa de descarte de repetido ANTES de consultar o banco | `lib/mensageria/entrada-conexao.test.ts` |
| 2 | Reconexão do WhatsApp em pingue-pongue | Monitor reconectava em `440` (sessão aberta em outro lugar) → derrubava a outra → caía de novo (1.245 "reconectado", 3.043 "caiu" em 7 dias) | Sem reconexão em 401/440; no máximo 3 tentativas por queda | Ler o MOTIVO da queda antes de agir; nunca repetir uma ação automática sem teto total | `lib/whatsapp-monitor-evento.test.ts` (enxurrada) |
| 3 | WhatsApp desconectado continuava consumindo | Cron conferia e regravava todas as lojas a cada 2 min; faixa vermelha de cada aba do painel consultava a cada 60 s (117/h); lembrete a cada 24 h | Regra do dono: desconectada fica parada em silêncio; faixa removida; 1 aviso só ao Super Admin | Recurso opcional desligado = 0 consultas; não cobrar o lojista com faixa fixa | `lib/whatsapp-monitor.test.ts` |
| 4 | **Alertas de custo (loop, limite, teto da IA) não chegavam a ninguém** | Saíam só pelo WhatsApp da loja Menuzia, desconectado desde 23/10 | Gravam pendente em `sistema_alertas`; o cron envia (push) | Todo alerta precisa de canal de reserva e de histórico visível no Super Admin | `lib/custo/alerta-whatsapp.test.ts` |
| 5 | Trava "um de cada vez" (Pix, entregas) podia ficar presa para sempre | Rodada que nunca termina (chamada sem resposta) nunca soltava a trava → Pix/entregas paravam até reiniciar | Trava solta sozinha em 10 min; a rodada velha não solta a nova | Toda trava em memória precisa de prazo de validade | `lib/saude/cron.test.ts` |
| 6 | Status para iFood/99 com erro reenviado todo minuto, sem limite | Erro só gravava `erro_envio`; o cron seguinte tentava de novo (~720×/etapa) | Espera 1, 2, 4… 60 min e para em 8 erros (0233) | Todo retry automático: espera crescente + limite de tentativas | `lib/espera-tentativas.test.ts` |
| 7 | Pix com erro do Mercado Pago consultado todo minuto, para sempre; 200 presos tampavam a fila | Sem prazo nem espera; fila por "mais antigos" | Espera crescente (1 min → 1×/dia), mais novos primeiro; status nunca muda sozinho | Fila com limite: ordenar pelo que importa agora; nunca expirar dinheiro sem confirmar | `lib/espera-tentativas.test.ts`, `lib/pagamentos/verificar-pendentes.test.ts` |
| 8 | Corrida ativa consultada no parceiro ~1/min a corrida toda | Intervalo fixo; e `atualizarCorrida(id, {})` não grava nada (objeto vazio) → "última consulta" nunca registrada | Intervalo pela idade (1 → 3 → 10 min) e coluna `consultado_em` gravada sempre | Ao "marcar que consultei", conferir que a função realmente grava | `lib/espera-tentativas.test.ts` |
| 9 | Frete consultado a cada pedaço do endereço digitado | Bastava o bairro; cada pausa de 600 ms na rua/número consultava (28/10: 13 geocodificações para 4 pedidos) | Só com rua + número + bairro, 800 ms, cache por endereço | Chamada que pode virar API paga: só com a entrada completa, espera e cache no cliente | `lib/frete-vitrine.test.ts` |
| 10 | Uma loja podia gastar a cota de Maps/entregadores de todas | Limite só do sistema | Teto por loja = 60% do limite (0230; entregadores em 29/10) | Toda cota compartilhada precisa de teto por loja | `lib/custo/guarda.test.ts` |
| 11 | Limite de pedido por IP podia bloquear cliente legítimo | 15/min por IP no sistema todo: IP de operadora (CGNAT) somava lojas diferentes | 15/min por IP **em cada loja** | Limite por IP sempre junto da loja/recurso | `lib/pedidos/limite-publico.test.ts` |

### Deploy / código

| # | Bug | Causa | Correção | Como evitar | Teste |
|---|---|---|---|---|---|
| 12 | **Build do Coolify falhou** ("Can't resolve 'net'") | Arquivo que também vai para o navegador (guarda de custo, via frete) passou a importar `web-push` | Guarda só grava; o envio é do cron | Código importado por tela não pode importar biblioteca só de servidor (web-push, sharp, ffmpeg, pg, net). tsc e vitest NÃO pegam — só o build | `lib/guardas/bundle-cliente.test.ts` (B6) |
| 13 | Barra invertida sumiu do código (`\n`, `\S`) | Editado por script Python/heredoc | Refeito com Edit | Código com `\` só com Edit/Write (CLAUDE.md, B1/B4) | guarda B1/B4 no `npm run checar` |
| 14 | Commit falhou com arquivo apagado | `git add` de um caminho já removido pelo `git rm` | Commit sem o caminho | Arquivo apagado: só `git rm`, não repetir no `git add` | — |
| 15 | Tela nova com `font-bold` (700) | Regra do painel: peso máximo 600 | `font-semibold` | Rodar o `checar` antes do commit | `lib/peso-fonte.test.ts` |
| 16 | Testes que estouram 5 s com a máquina carregada | Import pesado (`./entrada`) + outra sessão rodando | Prazo de 20 s nesses testes | Teste lento por carga: rodar só ele de novo e registrar | — |

### Medição / alertas (números errados levam a decisão errada)

| # | Bug | Causa | Correção | Como evitar |
|---|---|---|---|---|
| 17 | Falso "laço de 270 mil consultas/min" | Delta do `pg_stat_statements` indexado só por `queryid` — o mesmo id aparece uma vez por papel; comparava linhas diferentes | Somar por `queryid` antes do delta | Desconfiar de número absurdo; conferir com outra fonte (ex.: tempo negativo = artefato) |
| 18 | Egress estimado no dobro | 1,2 KB/requisição medido no plano grátis | Calibrado contra a página Usage: 700 B | Toda estimativa: calibrar contra o número oficial e dizer "estimado" na tela |
| 19 | Alerta de CPU disparando em todo deploy | "Carga média" (fila de processos) ≠ % de CPU; build de 10–15 min | % de CPU do `/proc/stat`; alerta só com 90%+ por 15 min | Usar a mesma métrica do painel oficial (Hostinger) e exigir duração |
| 20 | "93 MB de entrada no Supabase" | Era o tráfego de entrada da VPS (Hostinger), ponto de 30 min, durante builds | Medido por container (`nsenter`) e por IP de origem | Identificar a fonte do número antes de procurar a causa |

### Outros

| # | Bug | Correção |
|---|---|---|
| 21 | 60 itens com foto e sem miniatura (importações): a lista baixava a foto grande | `scripts/imagens/gerar-miniaturas.mjs` (lista −64%); importação deve gerar o par foto+miniatura |
| 22 | Disco da VPS a 61% com 35 GB de imagens/cache do Docker | Limpeza (→ 35%), mantendo as 3 últimas versões; alerta de disco no vigia |
| 23 | Batida dos crons gravava 540×/h; vigia sem trava de concorrência | Batida 1× a cada 5 min por cron; vigia em `umaPorVez` |

## Regras gerais que saíram daqui
1. Toda ação automática repetida (retry, reconexão, consulta) tem **espera crescente e limite total**.
2. Todo evento externo repetitivo é descartado **antes** de tocar no banco.
3. Recurso opcional desligado = **zero** consultas e zero cobrança visual ao lojista.
4. Todo alerta tem canal de reserva (push) e aparece no Super Admin.
5. Toda cota compartilhada tem teto por loja.
6. Antes de afirmar, medir com a fonte certa e calibrar contra o número oficial.
7. `npm run checar` antes de todo deploy; código de tela não importa biblioteca de servidor.
