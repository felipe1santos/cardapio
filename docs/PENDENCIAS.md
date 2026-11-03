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

## Pedidos do dono em 02/11/2026 (a implementar; nada começado)
| # | O quê | Detalhe / como |
|---|---|---|
| 19 | Gestor de Cardápio: coluna com ícone "por que não aparece na vitrine" | Complementa o commit `3270bdcc` (branch `publicar`, ainda não em `main`): hoje o motivo sai como texto amarelo ao lado do selo. Pedido: coluna própria na tabela (e canto do cartão na grade) com ícone + tooltip usando `motivoForaDaVitrine` (lib/item-visibilidade.ts). Ícones por motivo: calendário (dia), tag (sem categoria), loja (só salão), relógio (horário da categoria). Zero regra nova. |
| 20 | Datas no padrão DD/MM/AAAA em todo cadastro de data | Hoje são 12 arquivos com `<input type="date">` (Super Admin validade, promoções, agendamento, fidelidade, campanhas…). O navegador mostra no idioma do SO (em inglês vira MM/DD/YYYY). Solução: um componente único `CampoData` (texto com máscara `DD/MM/AAAA` + calendário opcional) que grava ISO por baixo; trocar os 12 usos; teste de conversão nos dois sentidos. Começar pelo Super Admin (`CampoValidade`). |
| 21 | Imagem da prévia do WhatsApp escolhida pelo lojista | Hoje `lib/previa-loja.ts` monta a og:image a partir do banner (sem banner: logo + nome). Pedido: campo "Imagem do link (WhatsApp)" em Ajustes › Aparência da loja: upload próprio (1200×630, JPEG < 300 KB, mesma rotina `sharp`), com "usar o banner" como padrão. Coluna nova `previa_link_url` em `restaurantes` + grant select para anon/authenticated (regra: coluna nova em restaurantes precisa de grant, senão o painel abre vazio) + entrar no hash `versaoPrevia` para furar o cache do WhatsApp. |
| 22 | Acesso expirado: mensagem clara + pagamento | **Já existe parcialmente.** No login, `lib/auth/entrada.ts` manda para `/login` com "Seu acesso expirou. Fale com a Menuzia para renovar." (também "desativado" e "suspenso" para funcionário). **Falta:** (a) quem já estava logado quando venceu: a RLS (0060) deixa de devolver a loja e o painel fica vazio/`sem-acesso` sem explicar — o middleware precisa conferir `acesso_expira_em` e mandar para a tela de aviso; (b) texto no padrão pedido: "Seu acesso expirou. Regularize o pagamento para voltar a usar o sistema." com botão para pagar (link da fatura, item 23) e WhatsApp da Menuzia; (c) aviso prévio no painel (7 e 3 dias antes de vencer). |
| 23 | Assinatura com liberação/bloqueio automáticos | Plano abaixo. **Recomendação: Asaas.** Depende do dono criar a conta Asaas e colar a chave no Coolify. |

### Plano da assinatura (item 23) — Asaas × Mercado Pago, decidido em 02/11/2026

**Por que Asaas.** Assinatura nativa: o Asaas gera a cobrança todo mês sozinho (Pix, boleto ou cartão), manda o lembrete ao
lojista por e-mail/WhatsApp e avisa o sistema por webhook quando pagou ou atrasou. Taxa pública (out/2026): R$ 1,99 por Pix ou
boleto recebido, cartão 2,99% + R$ 0,49, sem mensalidade; promoção de 3 meses a R$ 0,99 e Pix isento nas 100 primeiras
transações do mês. Numa mensalidade de R$ 100–200 por loja, custa R$ 1,99 fixo (Pix) contra 0,99% (R$ 1–2) no Mercado Pago —
parecido no Pix, mas no cartão o MP cobra 3,98–4,98% contra 2,99%. O Mercado Pago tem "Assinaturas" (preapproval) bom para
cartão; Pix/boleto em assinatura é recente e menos documentado; e a conta MP que já existe no sistema é a de cada LOJA (Pix do
pedido), não serviria de qualquer jeito para cobrar a Menuzia. Fontes:
[taxas Asaas](https://blog.asaas.com/taxas-asaas/), [Pix Asaas](https://blog.asaas.com/pix/),
[comparativo Asaas/iugu out-2026](https://quasa.io/pt/media/asaas-ou-iugu-tarifa-publicada-vence-ate-o-volume-pedir-proposta),
[assinaturas Asaas (FAQ)](https://docs.asaas.com/docs/faq-assinaturas), [Pix Automático × Assinaturas](https://docs.asaas.com/docs/diferença-entre-pix-automático-e-assinaturas),
[taxas Mercado Pago out-2026](https://www.calculadoradetaxas.com.br/mercado-pago/taxas), [assinaturas Mercado Pago](https://www.mercadopago.com.br/blog/como-receber-pagamentos-recorrentes).

**Carga no sistema (dúvida do dono).** Webhook não é consulta nossa: é o Asaas que chama UMA vez por evento (pagou, atrasou,
estornou) — umas 2–3 chamadas por loja por mês. Zero polling, zero custo de API. No login o sistema já lê `acesso_expira_em`
(coluna própria): não precisa perguntar nada ao Asaas na hora de logar. Então: webhook grava a data; login só lê a data.

**Desenho (mínimo).**
1. Banco: tabela `assinaturas` (restaurante_id, asaas_cliente_id, asaas_assinatura_id, plano, valor, status, proximo_vencimento,
   ultimo_evento_id, atualizado_em) + `eventos_asaas` (id do evento, recebido_em) para descartar evento repetido ANTES de gravar
   (regra das CORRECOES-DE-BUGS).
2. Super Admin: botão "Criar assinatura" na loja (cria cliente + assinatura no Asaas pela API; valor e dia de vencimento);
   mostra status (em dia / atrasada / cancelada) e link da última fatura.
3. Webhook `POST /api/webhooks/asaas`: valida o header `asaas-access-token` (segredo só no Coolify); `PAYMENT_RECEIVED` ou
   `PAYMENT_CONFIRMED` → `acesso_expira_em = vencimento da cobrança + 1 mês + 5 dias de carência`; `PAYMENT_OVERDUE` → só marca
   "atrasada" (a data de expiração já cuida do bloqueio); `SUBSCRIPTION_DELETED` → não renova. Sempre reconsulta a cobrança na
   API antes de gravar (não confia no corpo). Responde 200 rápido; erro nosso = 500 para o Asaas reenviar (ele tem fila e retentativa).
4. Tela do lojista: "Seu acesso expirou. Regularize o pagamento para voltar a usar o sistema." + botão "Pagar agora" (URL da
   fatura Asaas) + WhatsApp da Menuzia (item 22). Aviso 7 e 3 dias antes no topo do painel.
5. Segurança/custo: todas as chamadas ao Asaas por `chamarApiPaga()`? Não é API paga por chamada, mas passa pela mesma guarda
   com teto diário (ex.: 200/dia) para nunca entrar em loop. Chave `ASAAS_API_KEY` e `ASAAS_WEBHOOK_TOKEN` só no Coolify.
   Sandbox do Asaas para testar antes (conta de teste separada).
6. Ordem: 22a (bloqueio mid-sessão + tela) → sandbox Asaas → tabela + webhook (teste com evento falso assinado) → Super Admin →
   produção com a Menuzia primeiro → demais lojas.

**O que só o dono faz:** criar a conta Asaas (CNPJ, verificação), gerar a chave da API e o token do webhook, colar no Coolify;
decidir valor da mensalidade, dia de vencimento e carência.
| 24 | Asaas: "ping" mensal para a chave não expirar por falta de uso | O Asaas desativa chave sem uso há 3 meses e expira em 6. Cron mensal com 1 `GET /payments?limit=1` por `lib/custo/asaas.ts` (1 chamada/mês). |
| 25 | Super Admin: coluna "Assinatura" por loja | plano · situação (aguardando/em dia/atrasada/cancelada) · próximo vencimento · link da fatura (`lib/assinatura/repo.ts` → `buscarAssinaturaDoUsuario`). |
| 26 | Fatura do Asaas com "Menuzia" e logo (adiado pelo dono em 02/11) | Nome fantasia: Receita › Alteração cadastral do MEI (mei.receita.economia.gov.br/alteracao, gov.br da titular) → "Menuzia" → no Asaas, Minha conta › Informações › "Clique aqui" → escolher o nome. Logo: Asaas › Minha conta › Personalização › Editar › Com marca › Adicionar marca (`C:\projetos\ARQUIVOS IMPORTANTES\LOGO-MENUZIA.png`) › Aplicar. |
| 27 | Asaas: erro 400 mostrar a descrição do Asaas; valor de teste mínimo R$ 5 | `lib/custo/asaas.ts` `mensagemErro`: para 400 `invalid_value`, mostrar a `description` (ex.: "valor mínimo R$ 5,00"); `valorDoPlano` trava `ASSINATURA_VALOR_TESTE` em ≥ 5. |
| 28 | Registrar 0234–0242 em `schema_migrations` | Foram aplicadas sem registro (a 0242 existe no banco; o registro parou na 0233). Inserir os nomes para o aplicador genérico voltar a conferir "última = anterior". |
| 29 | **Apagar a Estância Burger** (dono fecha a empresa) | Super Admin › Excluir dados › "Estância Burger". A função 0244 `plataforma_excluir_loja` já está aplicada (ensaio: 359 pedidos, 475 auditoria, 69 lançamentos, equipe, loja). Depois: conferir no banco que não sobrou linha. |
| 30 | Custos fixos: valor da VPS | Super Admin › Gastos de API › Custos fixos › "VPS Hostinger (R$)". Sem isso o card "Custo do sistema" mostra só o Supabase (US$ 25). |
| 31 | Monitor externo (VPS cai = vigia cai junto) | Dono cria conta no UptimeRobot/Better Stack; configurar GET `/login` a cada 5 min com aviso no WhatsApp/e-mail. |
| 32 | Build fora da VPS (deploy usa 88% da CPU por 10 min) | Precisa de registry privado (a imagem leva GOOGLE_MAPS_BROWSER_KEY em build time). GitHub Actions gera a imagem; Coolify puxa. Só quando passar de ~15 lojas. |
| 33 | Assinatura: pendências menores | e-mail fora do caminho da resposta do webhook (M4); mensagem certa para assinante com fatura em aberto (`error=pendente`); retenção de `asaas_eventos`; "Pagar agora" só com fatura não paga; reenvio com outro plano devolve a fatura antiga. |
| 34 | Registrar 0243–0244 em `schema_migrations` | Junto da 28. |
