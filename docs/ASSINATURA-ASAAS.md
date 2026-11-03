# Assinatura paga via Asaas (02/11/2026)

Decisões do dono (02/11): botão **"Adquirir acesso"** no login → `/assinar` (plano + cadastro) → fatura do Asaas
(Pix, boleto ou cartão) → webhook "pagou" libera o acesso e manda e-mail com os dados de acesso. **Sem acesso antes
de pagar.** Mensal a partir da data da compra, **5 dias de carência**. Dois planos (site www.menuzia.com.br):
**Básico R$ 97** e **Completo R$ 149** (Completo = Básico + Agente de IA, Disparos e Financeiro — as três chaves de
`loja_modulos`). WhatsApp fica para depois; só e-mail (Resend).

## Fluxo

1. `/assinar`: plano, nome, loja, e-mail, celular, CPF/CNPJ (o Asaas exige), usuário, senha. Limite por IP.
2. Servidor (`lib/assinatura/fluxo.ts` → `iniciarAssinatura`): cria o usuário no Auth (senha já definida) e a linha
   em `usuarios` com `autorizado=false` e `restaurante_id=null` (igual ao pré-cadastro do Super Admin); cria cliente e
   assinatura no Asaas (`externalReference = usuarioId`, `billingType = UNDEFINED`, `cycle = MONTHLY`,
   `nextDueDate = hoje`); pega a 1ª cobrança (`invoiceUrl`); grava em `assinaturas`; redireciona para a fatura.
   Asaas falhou → apaga o usuário criado e mostra erro (nada fica pela metade).
3. Webhook `POST /api/webhooks/asaas` (`lib/assinatura/webhook.ts` → `processarEventoAsaas`):
   - header `asaas-access-token` = `ASAAS_WEBHOOK_TOKEN` (comparação em tempo constante); errado → 401.
   - `id` do evento gravado em `asaas_eventos` ANTES de qualquer efeito; repetido → 200 sem efeito.
   - só eventos `PAYMENT_*` com `payment.subscription` nosso; a cobrança é RECONSULTADA na API (o corpo não é verdade).
   - `PAYMENT_CONFIRMED`/`PAYMENT_RECEIVED`: primeira vez → cria a loja (`restaurantes`), vira `dono`, `autorizado=true`,
     `acesso_expira_em = vencimento + 1 mês + 5 dias (23:59 SP)`, liga as chaves do plano em `loja_modulos`, e-mail
     "acesso liberado"; renovação → só estende `acesso_expira_em` (nunca encurta). `PAYMENT_OVERDUE` → `atrasada` + URL
     da fatura (a data de expiração já bloqueia sozinha). `PAYMENT_DELETED`/`REFUNDED` → `cancelada`.
   - erro nosso (banco/API) → 500 para o Asaas reenviar; 15 falhas seguidas pausam a fila lá (ver logs no painel Asaas).
4. Bloqueio: já existe. Login (`lib/auth/entrada.ts`) e meio da sessão (RLS 0060 + middleware → `/login?error=acesso`).
   A mensagem passa a ser "Seu acesso expirou. Regularize o pagamento para voltar a usar o sistema." com **Pagar agora**
   (URL da última fatura em `assinaturas`).
5. Super Admin: coluna "Assinatura" (plano · situação · vencimento · fatura). As lojas antigas (sem Asaas) continuam
   com a validade manual.

## Banco (0243)

`assinaturas` (1 por usuário dono; só service role) e `asaas_eventos` (idempotência). Nenhum grant para anon/authenticated.

## Custo/segurança

- Asaas e Resend passam por `chamarApiPaga` (`lib/custo/asaas.ts`, `lib/custo/resend.ts`), tetos `LIMITE_ASAAS_DIA`
  (200) e `LIMITE_EMAIL_DIA` (200); hosts na regra-1.
- Segredos só no Coolify (sem Build time): `ASAAS_API_KEY`, `ASAAS_WEBHOOK_TOKEN`, `RESEND_API_KEY`,
  `EMAIL_REMETENTE` (ex.: `Menuzia <nao-responda@menuzia.com.br>`). `ASAAS_API_URL` opcional (sandbox).
- Webhook responde rápido; nada de processamento longo antes do 200.

## O que o dono faz no Asaas / Resend / Coolify

1. Asaas › Integrações › **Chaves de API**: gerar → `ASAAS_API_KEY` no Coolify.
2. Asaas › Integrações › **Webhooks**: URL `https://app.menuzia.com.br/api/webhooks/asaas`, e-mail de aviso, token de
   autenticação (32+ caracteres, gerado por você) → o mesmo em `ASAAS_WEBHOOK_TOKEN`; eventos: PAYMENT_CONFIRMED,
   PAYMENT_RECEIVED, PAYMENT_OVERDUE, PAYMENT_DELETED, PAYMENT_REFUNDED; fila sequencial.
3. Resend: domínio `menuzia.com.br` (registros DNS no provedor do domínio) → API key → `RESEND_API_KEY`; e aproveitar
   para o SMTP do Supabase (pendência 15).
4. Deploy na janela (depois das 23h); teste real: assinar a Menuzia por R$ 1 (valor de teste via `ASSINATURA_VALOR_TESTE`
   só na primeira rodada), pagar o Pix, conferir webhook, e-mail e `acesso_expira_em`.

## Teste

`lib/assinatura/*.test.ts`: regras de plano, nova validade (fuso SP, nunca encurta), parse/validação do evento,
idempotência, token do webhook, validação do formulário (CPF/CNPJ, e-mail, usuário).

## Regras de acesso (decisão do dono, 03/11/2026)

- **Estorno (`PAYMENT_REFUNDED`) encerra o acesso na hora**: `acesso_expira_em = agora`, assinatura `cancelada`.
- **Loja "sem validade" é vitalícia**: `acesso_expira_em = null` nunca ganha validade, mesmo pagando pelo Asaas. No Super
  Admin o selo é **"Vitalícia"**.
- **Loja com validade que venceu fica disponível até a data** (vencimento + 1 mês + 5 dias de carência). Pagou depois →
  volta sozinha: o webhook reautoriza (`autorizado = true`) e grava a nova validade. Se o webhook se perdeu, o **login de
  quem está expirado confere no Asaas** (`lib/assinatura/reconciliar.ts`, 1 chamada pela guarda) e aplica a mesma renovação.
- **Cobrança apagada no Asaas (`PAYMENT_DELETED`) não é cancelamento**: o sistema reconsulta a assinatura lá; só marca
  `cancelada` se ela estiver inativa, e mesmo assim o acesso fica até a validade.
- **Aviso no painel** (`components/admin/aviso-assinatura.tsx`, `/api/admin/assinatura/aviso`, 1 leitura ao abrir e a cada
  30 min): "Sua assinatura precisa ser regularizada: pagamento pendente. O acesso continua até dd/mm" + **Pagar agora**, quando
  a mensalidade venceu (ou o Asaas marcou atrasada) e a loja está na carência.
- **Webhook com falha no meio** (03/11): o id do evento é desfeito e o reenvio do Asaas reprocessa; erro gera alerta ao
  Super Admin; cadastro desfeito e lojista excluído cancelam a assinatura no Asaas.
- **Exclusão definitiva** (Super Admin › Excluir dados, 0244): `plataforma_excluir_loja(uuid)` apaga tudo da loja (inclusive
  financeiro e auditoria, como postgres) e as contas de autenticação; irreversível e só com acesso já revogado/expirado.
