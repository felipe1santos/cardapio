# Financeiro Fase 4 — Fluxo de Caixa: regras de cálculo

Tela: Financeiro › Fluxo de Caixa. **Só leitura**: nada se edita aqui, e o livro-caixa continua imutável no banco.

**Fonte dos números**
- Os números saem do livro-caixa (`fin_lancamentos`) e da tabela de turnos (`caixa_turnos`), pela função
  `fin_fluxo_turnos` (migration 0140).
- Não há total digitado nem tabela paralela de totais.
- A soma é feita no banco e cobre o **período inteiro**, sem o limite silencioso de 1000 linhas.

## Turnos e datas
- **Uma linha por turno.**
- O turno pertence à **data de abertura** no horário de São Paulo. Um turno aberto às 23:30 e fechado às 02:00
  aparece no dia da abertura.
- Turno aberto aparece no topo, "Em andamento", com os valores até agora.
- **Status:**
  - *Em andamento*: aberto;
  - *Reaberto*: reaberto e ainda aberto;
  - *Fechado*;
  - *Divergente*: fechado com diferença no dinheiro ou na maquininha;
  - Um turno que foi reaberto e fechado de novo ganha também o selo "Reaberto".
- **Lançamento sem turno** (o registro da entrega pelo motoboy, ou Pix conferido com o caixa fechado):
  - entra no turno cuja janela, da abertura ao fechamento, contém o horário dele;
  - fora de qualquer janela, vai para a linha "Fora de turno" do dia.

## Colunas
| Coluna | Como é calculada |
|---|---|
| Vendido | recebimentos + troco devolvido pelo motoboy − estornos, sem as contrapartidas internas (conta da empresa, resultado) |
| Recebido | vendido − "a receber" (fiado, não pago, Nexta) |
| Dinheiro / Pix (total) / Cartão / Outras | o vendido separado pela forma |
| Pix confirmado | Pix conferido no turno |
| Pix a conferir | Pix que entrou no turno e ainda não foi conferido (situação atual) |
| PDV/balcão, Mesas, Delivery, Online | o vendido separado pela origem do lançamento |
| Taxas e descontos | das contas (`comanda_totais`) e dos pedidos sem conta (taxa de entrega, desconto) ligados aos recebimentos do turno; cada conta conta uma vez, no turno do primeiro recebimento |
| Cancelamentos | pedidos cancelados durante a janela do turno (valor e quantidade) |
| Estornos, sangrias (+ retiradas), despesas (+ perdas e compras), reforços | lançamentos do tipo no turno |
| Dinheiro c/ motoboy | movimento da carteira do motoboy no turno: troco entregue + recebido na rua − acertado − pendências |
| Dinheiro esperado | o que o fechamento **gravou** (turno fechado) ou o saldo da gaveta agora (turno aberto) |
| Dinheiro informado / Diferença | o que foi contado no fechamento e a diferença gravada (verde = zero, vermelho = falta, âmbar = sobra) |

## Filtros
- **Origem, forma, operador e motoboy filtram os lançamentos:** os valores mostrados passam a ser só deles, e turno
  sem nenhum lançamento filtrado some.
- **Status** filtra os turnos.
- **Produto** mostra só os turnos com venda do produto, com a quantidade e o valor dele em cada turno.
- Os filtros ficam na URL: o link pode ser compartilhado e o "voltar" do navegador desfaz o último filtro.
- O período máximo é de 400 dias.

## Exportação
**Permissão:** própria, "Exportar relatórios financeiros" (`financeiro_exportar`).
- Dono sempre pode.
- Gerente pode pelo padrão do papel.
- Gerente (cargo gerente) com acessos personalizados que já via o financeiro ganha a permissão na 0140, só em loja com financeiro: em produção, ninguém (o único candidato, `garcom123` da Menuzia, tem cargo de garçom).

**CSV** para o Excel em português:
- UTF-8 com BOM, separador ";", valores 1.234,56, datas dd/mm/aaaa hh:mm e linha de total;
- texto que começa com = + - @ ganha um apóstrofo e vira texto (proteção contra injeção de fórmula).

**PDF:**
- documento com loja, período, filtros, quem gerou e quando, a tabela e os totais;
- o navegador salva como PDF, em A4 paisagem;
- o extrato de um turno também exporta, em CSV e em PDF.

**Auditoria:** toda exportação é registrada (`fin.exportou_fluxo`), com quem, quando, filtros e formato. O
"Reimprimir relatório" também é registrado (`fin.reimprimiu_relatorio`).

## Segurança
- A tela e a API exigem "ver financeiro" (área + permissão) e conferem tudo no servidor.
- Garçom, cozinha e motoboy não acessam.
- Turno ou exportação de outra loja pelo ID → 404.
- As rotas do fluxo só leem: PATCH, PUT e DELETE devolvem 405.
- O livro-caixa recusa alteração e exclusão inclusive do `service_role` (0132). Só o papel de manutenção do banco
  passa por cima, por desenho.
