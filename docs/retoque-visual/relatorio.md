# Relatório — retoque visual: painel, vitrine e PDV/Mesas (01/10/2026)

- **Em produção:** main **0f73629**.
- **Migrations aplicadas:** **0123**, **0124** e **0125**. Antes de cada uma: backup em `~/backups/menuzia/2026-10-01-pre-NNNN`, teste a seco e conferência.

**Decisões do dono antes de começar:**
- O recibo/extrato **impresso** e o Assistente de Impressão ficaram intactos. As taxas aparecem como linhas separadas na tela, na pré-conta da tela, no fechamento e no financeiro; no papel sai a soma, com os nomes juntos.
- O painel em produção só é conferido com o dono logado: não digito senha em produção.

## 1. O que mudou

### 1. Clientes
- A tabela ganhou rolagem própria, vertical e horizontal, com barra fina e discreta.
- O cabeçalho fica fixo e a coluna **Cliente** fica presa à esquerda.
- Só as linhas visíveis são desenhadas. Com 260 clientes, 24 linhas no DOM.
- A base inteira já vem do servidor de uma vez (as métricas são calculadas a partir dos pedidos), então a busca sempre cobre **todos** os clientes.
- A busca e o botão "Exportar CSV (Meta Ads)" passaram para dentro do card, à direita do título.
- O contador fica ao lado do título: "Clientes · 261 clientes", ou "1 de 261 clientes" durante a busca.
- No celular, título e contador ficam em cima; busca e botão embaixo, em largura total.

### 2. Painel de Pedidos
- Os 4 cards usam **o mesmo componente** da tela Clientes (`CartaoNumero`): ícone em círculo, rótulo pequeno sem caixa alta, valor grande.
- Cores: laranja, azul, roxo e verde. O faturamento continua em verde.
- Os números continuam em tempo real. O kanban e os botões do topo não foram mexidos.

### 3. Bug do aviso com e-mail
- **Causa: preenchimento automático do navegador.**
  - O campo do aviso não tinha `name`, `type` nem `autocomplete`.
  - A página tinha, no tempo todo, os campos de senha da aba **Conta** — só escondidos, mas presentes.
  - O Chrome tratava a tela como formulário de login e punha o e-mail salvo no primeiro campo de texto.
- **Correção:**
  - o campo agora tem `type="text"`, `autocomplete="off"`, `name`/`id` próprios e marcações para gerenciadores de senha ignorarem;
  - os campos de senha só existem no DOM com a aba Conta aberta.
- **Dado salvo:** conferido no banco de produção, só leitura. Nenhuma loja tem e-mail salvo no aviso. Só duas lojas têm aviso preenchido, ambas com texto de teste: Menuzia ("POKSAOPKOS…") e Ponto 400 ("avisoaaaa…").
- Salvar o campo vazio já gravava "sem aviso"; agora isso está coberto por teste (apagar, salvar, recarregar: continua vazio).

### 4. Aviso da vitrine
- Cor do texto e cor do fundo: paleta pronta mais campo hex. O ícone acompanha a cor do texto.
- Efeito **pulsar**: escala 1 → 1,02 com opacidade, ciclo de 1,2 s, só CSS `transform`/`opacity`.
- Botão **Padrão** volta ao visual de sempre.
- **Prévia ao vivo**, feita com o mesmo componente da vitrine.
- Alerta "Texto pode ficar difícil de ler" quando o contraste fica abaixo de 4,5:1 (WCAG AA). Não bloqueia o salvamento.
- Salvo por loja (0123). As lojas atuais ficam no padrão.

### 5. Cupom/prêmio na vitrine
- A faixa ficou **azul** (#E0F2FE / #0369A1, borda #7DD3FC), com ticket SVG local que balança a cada ~3 s e pulsar leve. O texto e a lógica são os mesmos.
- O clique leva à aba **Cupons**, com o disponível destacado por ~2,5 s.
- O botão **Resgatar**:
  - valida no servidor;
  - mostra check verde + 10 confetes CSS (~1 s) e vibra 35 ms;
  - aplica o cupom (ou guarda o prêmio) e leva à sacola com "Cupom X aplicado – R$ Y" / "Brinde: …".
- Se o cupom não puder ser usado (ex.: abaixo do mínimo), aparece o motivo em vez do efeito.
- Na aba Cupons, o cupom resgatado aparece como "Na sacola · remover".
- **Regras de uso:**
  - resgatar não consome; o consumo acontece só com o pedido criado (já era assim);
  - remover, esvaziar a sacola ou recarregar devolve o cupom à aba;
  - pedido que falha devolve o uso.
- **Achado e corrigido (0125):** o "uso único por cliente" não protegia duas compras simultâneas do mesmo telefone (duas abas/aparelhos) — as duas levavam o desconto. Agora o servidor reserva (cupom, telefone) antes de criar o pedido e devolve se o pedido falhar. Teste: duas requisições ao mesmo tempo → só uma passa.

### 6. Mesas, comandas e PDV
- **6.1 Lançar itens:**
  - o sucesso virou **toast** ("Pedido #X lançado em …") com o atalho "Ver conta";
  - na barra de baixo: [⬅ Mesas/Balcão] [Ver conta, com badge do valor em aberto] [Lançar na cozinha];
  - o topo ficou livre para o novo pedido.
- **6.2 Conta:**
  - barra fixa embaixo: **Receber** (azul) e **Fechar conta** (verde), com 60 px;
  - secundárias com ícone + legenda: Lançar, Imprimir, Taxas, Desconto, Pendências, Cliente, Histórico;
  - **Cancelar** em vermelho no fim, com o modal de motivo de sempre;
  - a coluna da direita ficou só com o resumo e o cupom;
  - itens com **foto**.
- **6.3 Sugestão de cliente:**
  - funciona em mesa/comanda, no "Cliente" da conta e no balcão;
  - a partir de 2 letras, espera 200 ms e mostra nome + telefone + última compra;
  - navega por toque e por teclado;
  - escolher preenche nome e telefone, e o servidor vincula o cadastro pelo telefone, como já fazia;
  - a rota usa a loja da sessão e fica fora das áreas do menu, para garçom e caixa não esbarrarem no controle de acessos.
- **6.4 Fechar em etapas:**
  - **1. Pendências** (obrigatório decidir cada uma) → **2. Taxas** → **3. Pagamento** (saldo coberto);
  - o pagamento só abre com tudo decidido;
  - **várias taxas** (0124): % do subtotal, valor fixo ou por pessoa × quantidade;
  - atalhos com as **taxas padrão** da loja (Ajustes › Mesas);
  - cada taxa aparece como linha separada na conta e no fechamento;
  - **saldo zero**: avisa "Recebido R$ 0,00", pede confirmação no próprio botão e grava `conta.fechou_valor_zero` na auditoria, com quem fechou.
- **6.5 Pagamento touch** (duas colunas, como no PDV):
  - à esquerda, itens com foto, taxas e resumo;
  - à direita, o restante a pagar no topo, formas de pagamento em botões grandes com ícone, teclado numérico de 56 px, atalhos (Exato, R$ 50/100/200), troco em destaque e "+ Outra forma de pagamento";
  - "Fechar conta" grande e verde.
- **6.6 Selos:**
  - Cozinha: Aguardando aceite (âmbar), Em preparo (azul), Pronto (verde), Entregue (cinza);
  - Atendimento: Aguardando (âmbar), Tudo entregue (verde);
  - Financeiro: Pago (verde), A receber (laranja), Entregue a receber (vermelho), Parcial (âmbar), Cancelado (cinza);
  - aparecem no Balcão e na conta; a linha que pede ação ganha borda vermelha à esquerda.
- **6.7 Fotos:** miniatura de 40–48 px, lazy, na versão pequena, com ícone neutro quando não há foto. Aparece no novo pedido, na conta e no fechamento/pagamento.

## 2. Desempenho dos efeitos
Medição em `medicao-efeitos.json`, com `scripts/vitrine/medir-efeitos.mjs`: celular simulado, **CPU 4× mais lenta**, 6 s rolando com o aviso pulsando e a faixa balançando.

| | FPS | Quadros > 50 ms | Long tasks |
|---|---|---|---|
| Com efeitos | 60 | 0 | 0 |
| Reduzir movimento | 60 | 0 | 0 |

- Com "reduzir movimento" ligado, todos os efeitos ficam desligados (`animation: none`).
- Fora da tela, as animações pausam.
- O CSS dos efeitos tem ~1,3 KB, sem bibliotecas.

## 3. Prints (docs/retoque-visual/prints/)
- **Clientes:** `clientes-desktop-topo`, `clientes-tablet-lado` (1024, coluna fixa e última coluna), `clientes-celular`.
- **Cards:** `cards-pedidos` × `cards-clientes`.
- **Aviso:** `aviso-editor`, `aviso-vitrine-390`.
- **Cupom:** `cupom-faixa-390`, `cupom-aba-destaque`, `cupom-sucesso`, `cupom-na-sacola`.
- **PDV:** `pdv-sugestao-cliente`, `pdv-depois-lancar-1280`, `conta-barra-1280`, `taxas-modal`, `fechar-pagamento-1280`, `fechar-pagamento-1024`, `balcao-selos-1280`.
- **Antes (produção, vitrine pública):** `antes-vitrine-menuzia-390` / `-desktop`. Não tenho prints "antes" das telas do painel: elas exigem login em produção.

## 4. Testes

**Novo e2e `scripts/vitrine/e2e-retoque-visual.mjs`: 46/46.**

**Regressão, todas verdes:**

| Suíte | Resultado |
|---|---|
| vitest | 1820 |
| PDV v2 | 70 |
| garçom | 47 |
| balcão | 84 |
| atendimento PDV | 97 |
| estabilidade | 53 |
| caixa | 18 |
| cozinha | 26 |
| modelos/taxa/Instagram | 57 |
| regressão-release | 52 |
| checkout | 72 |
| vitrine-tags | 20 |
| fase 3 | 51 |
| agendamento | 25 |

**Testes antigos ajustados por mudança intencional de UI:**
- `e2e-pdv-v2`: as dimensões viraram selos.
- `e2e-modelos-beta-taxa-instagram`:
  - modal novo de taxas;
  - botão "Salvar alterações", porque desde a Fase 7 existe também o "Salvar agendamento".

**Não testado:**
- impressão do recibo com várias taxas em impressora virtual — o recibo não mudou e sai a soma;
- Chrome com senhas salvas de verdade — a verificação foi pelos atributos do campo e pela ausência de campos de senha na página;
- conferência do painel em produção logado na Menuzia (pendente com o dono).

## 5. Dados TESTE
- **Local:** 260 clientes, cupons TESTERET/TESTEMIN, comandas "TESTE Retoque"/"TESTE Zero", aviso e flag do PDV v2 — tudo removido ou restaurado pelos próprios testes.
- **Produção:** nada criado.
