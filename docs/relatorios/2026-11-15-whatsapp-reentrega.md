# WhatsApp: reentrega da Evolution e reconexões — 15/11/2026 (madrugada, modo autônomo)

## O que aconteceu
- 00:15 o servidor da Evolution (`evolution.menuzia.com.br`, mesmo servidor do Mega Capotas) foi reiniciado na
  manutenção do dono. A instância da Gordelícia reconectou e o WhatsApp reentregou ~30 h de mensagens pendentes.
- Webhook da Gordelícia: ~60 eventos/min (normal 1–27 por hora nesse horário) → banco 500–780 req/min (normal ~110)
  → alerta "requisições acima do normal". Banco e VPS aguentaram (CPU 25–35%).
- O robô/IA respondeu 162 mensagens velhas de 44 clientes. Causa: `processarMensagemAuto` não olhava a hora da
  mensagem. A reentrega terminou sozinha ~00:55.

## No ar
| Commit | O quê | Conferido |
|---|---|---|
| b677ea3a | Robô/IA só responde mensagem com até 10 min (`lib/robo-auto/mensagem-antiga.ts`); a velha fica gravada na central | banco 88 req/min às 01:16; vps:lixo OK |
| d6fab6f1 | Webhook: lote só de grupo/status/vazio sai sem consultar o banco (regra 2); Super Admin: selo "Assinatura paga" com ícone do Asaas | selo aparece na Gordelícia em produção; Semgrep 0 achados |
| db81d42a | Instância nova já nasce com `groupsIgnore`; tooltip do selo com a data certa | — |

Fora do código (API da Evolution, reversível): `groupsIgnore: true` nas 5 instâncias de loja (Ponto 400, Menuzia,
Villa, Gordelícia, Ferraz); demais configurações conferidas iguais. Nenhuma função do Menuzia usa grupo.

## Decisões tomadas sozinho
- Limite de 10 min: reconexão normal entrega em segundos; depois de 10 min a resposta automática mais atrapalha.
- SAIR/VOLTAR antigo continua valendo (direito do cliente).
- Não pausei o robô da Gordelícia: o UPDATE direto no banco foi negado pela permissão; a reentrega acabou sozinha.

## Reconexões a cada 50 min (Villa e Gordelícia)
- Até 15/11 00:15 cada instância passava por `connecting → open` exatamente a cada 50 min, dia e noite, sem `close`
  antes (≈ 18/dia por loja). O Menuzia não pede reconexão nesses casos (só reconecta em queda).
- Depois do redeploy da Evolution pelo Coolify à 01:15 (recriou `.env`, compose, Postgres e Redis; mesma imagem
  v2.3.7) o ciclo **não voltou**. Os logs anteriores se perderam no restart; não deu para provar o motivo.
- Como conferir: `whatsapp_eventos` tipo `webhook` com `ignoradas.conexao_connecting` — mais de ~2 por loja por hora
  = ciclo voltou; aí ler `docker logs api-ww0wkggowcwo48www4co8sg4` no minuto do evento.

## Pendências para o dono
1. **Ponto 400**: WhatsApp desvinculado (401) desde 05/11 — a loja precisa ler o QR de novo (40 pedidos em 7 dias sem
   aviso por WhatsApp).
2. **Ferraz Burguer**: desvinculado (401) desde 04/11 — ler o QR.
3. Trocar o `webhook_segredo` da Gordelícia (apareceu no terminal da sessão; não foi para arquivo nem git).
4. Assinaturas: só a Gordelícia paga pelo Asaas (R$ 149, em dia até 08/12). David (acesso até 02/12) e Ferraz
   (até 03/12) não existem no Asaas — validade colocada à mão.

## Plano para reduzir mais (não feito; medir antes)
O WhatsApp no dia a dia é pequeno: ~425 webhooks/dia em todas as lojas (≈ 1,5% das ~227 mil requisições/dia). Só a
reentrega pesa. Próximos passos, em ordem de ganho:
1. Mensagem velha (>10 min) por um caminho leve: pular as checagens de "eco" e a classificação, gravar só a mensagem
   (sem silenciar a conversa por "a loja respondeu" há horas). Exige ajuste na RPC `whatsapp_auto_entrada` — migration
   nova com teste. Corta ~70% das consultas de uma reentrega.
2. Guardar em memória (30 s) a config + loja por segredo do webhook: −2 consultas por evento. Custo: mudança no robô
   leva até 30 s para valer.
3. Se o ciclo de 50 min voltar: achar a causa pelos logs no minuto do evento antes de mexer.
