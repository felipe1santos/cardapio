# Pendências (atualizado em 29/10/2026)

Origem: [diagnóstico de 29/10](relatorios/2026-10-29-diagnostico-custo-estabilidade.md) (números da lista de correções),
[varredura 28/10](relatorios/2026-10-28-varredura.md) e [auditoria das travas](relatorios/2026-10-28-auditoria-travas.md).
Regra: deploy só antes das 11h ou depois das 23h (CLAUDE.md).

## Depende do dono (Claude não pode: conta nova, senha, chave, pagamento)
| # | O quê | Como |
|---|---|---|
| 15 | E-mail próprio (SMTP) para login/senha | Criar conta em resend.com (grátis, 3 mil/mês) → Domains: adicionar `menuzia.com.br` e pôr os registros no DNS → API Keys: chave só de envio → Supabase › Authentication › Emails › SMTP: host `smtp.resend.com`, porta 465, usuário `resend`, senha = a chave, remetente `nao-responda@menuzia.com.br`. Depois o Claude sobe o limite de e-mails/hora e testa. |
| 1 | Monitor externo (UptimeRobot) | Conta em uptimerobot.com → 3 monitores: `https://app.menuzia.com.br/loja/menuzia` (depende do banco), `https://app.menuzia.com.br/api/vivo` (só o app), palavra-chave na vitrine; alerta por e-mail + app no celular. Passo a passo no diagnóstico (§5). |
| 7 | Decidir o teto de gasto do Supabase | Ligado = o sistema para ao bater a cota (como 27/10); desligado = paga excedente (US$ 0,09/GB de egress). Supabase › Billing › Spend cap. |
| 11 | Tokens para números oficiais na Saúde do sistema | `SUPABASE_ACCESS_TOKEN` (supabase.com › Account › Access Tokens) e `HOSTINGER_API_TOKEN` (hpanel.hostinger.com/profile/api, com validade) + `HOSTINGER_VPS_ID=1356364` — colar no Coolify (sem Build time). |
| — | WhatsApp de alertas (adiado pelo dono) | `cd C:\projetos\cardapio-estab-main` → `node scripts/saude/qr-alertas.mjs` e ler o QR no celular que vai mandar os alertas. Até lá, os alertas saem por push. |

## Aprovado para depois / ainda não (decisão do dono em 29/10)
| # | O quê | Por que esperar |
|---|---|---|
| 8 | Assistente de impressão: espera longa 50 s + cache de 30 s da configuração no servidor (−20% do banco) | Mexe na impressão: medir criado→impresso antes/depois (REGRA-CICLO-SEM-REDE) |
| 9 | Imagem do app enxuta (Next `standalone`) e/ou build fora da VPS | Build hoje usa a CPU da VPS das lojas (88%) |
| 12 | Segurança: revogar `execute` de anônimo em 15 funções SECURITY DEFINER internas; 16 funções sem `search_path`; proteção de senha vazada | Vem na auditoria de segurança |
| 16 | Separar o Menuzia (ou o Evolution) dos outros projetos da VPS / KVM 4 a partir de ~30 lojas | Quando crescer |
| 17 | Otimizar `painel_analytics_vitrine` (559 ms em média, até 2,8 s) | Quando crescer |
| 18 | Revisar políticas RLS sobrepostas (84 avisos), 24 FKs sem índice, 22 índices sem uso | Quando o banco passar de ~30% de CPU |

## Feito em 29/10 (para referência)
2 limpeza do Docker (já rodava a cada 6 h; agora guarda as 3 últimas imagens) · 3 healthcheck `/api/vivo` (healthy) ·
4 limite de memória 1,5 GB + Node 1,2 GB · 5 alerta de Assistente desligado com a loja aberta · 6 tetos de entrega 3.000/dia ·
10 página "Voltamos já" (e o bug do 404 com banco fora) · 13 um de cada vez em canais/WhatsApp + prazo na Evolution ·
14 Pix e vitrine clássica pausam com a aba escondida · `/` da VPS remontado sem `discard` (03h30).
