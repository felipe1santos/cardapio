# Clientes — botão CSV com importar e exportar (2026-10-01)

Branch `feat/clientes-csv`. Migration `0131_clientes_csv.sql` (rollback em `docs/rollback/0131_clientes_csv.down.sql`).
Métricas e tabela: só o descrito (importados entram com 0 pedidos; as métricas de compra olham só quem comprou).

## O que mudou
**Botão "CSV ▾"** no lugar do "Exportar CSV (Meta Ads)", mesmo lugar e estilo, com Importar clientes, Exportar
clientes e Histórico de importações (prints `01`). Só aparece para quem pode: dono, gerente (padrão do papel) ou
funcionário com acessos próprios que tenha a área Clientes **e** a permissão nova "Importar/exportar clientes"
(Equipe › Ações sensíveis). O servidor confere de novo em todas as rotas (`autorizarClientesCsv`) e o middleware
trata as rotas como ação sensível.

**Exportar** (`02`, `13`): Últimos 7/30/90 dias, Este mês, Todos e Personalizado; "Última compra no período"
(padrão) ou "Cadastrados no período"; somente recorrentes / somente 1x / somente com telefone; prévia "N clientes
serão exportados" ao vivo; formatos:
- Planilha completa (Excel): Nome, Telefone, Endereço, Pedidos, Última compra, Total gasto, Ticket médio,
  Recorrência, Dia preferido, Gasto por semana — `;`, UTF-8 com BOM, datas `dd/mm/aaaa, hh:mm`, valores `1.234,50`.
- Meta Ads: o mesmo arquivo de antes (`phone,fn,ln,zip,country,gen`, vírgula), gerado pela mesma função.
Arquivo `clientes-<loja>-<inicial>_<final>.csv`. Auditoria "Exportou a base de clientes" com formato, filtros e quantidade.

**Importar** em 3 etapas:
1. Modelo (`03`): tabela com as 12 colunas (nome* e telefone*), 2 exemplos, dicas, "Baixar modelo CSV"; área grande
   de arrastar e soltar ou clicar (abre o seletor do sistema, `accept=".csv"`), destaque ao arrastar (`10`), nome e
   tamanho do arquivo com "Trocar arquivo"; limites 5 MB / 20.000 linhas e recusa de arquivo que não é CSV (`09`).
2. Conferência (`04`, `06`, `07`) — nada é gravado: detecta separador, UTF-8 × Windows-1252 e cabeçalho; liga as
   colunas aos campos reconhecendo variações (Cliente, Celular, WhatsApp, Fone, E-mail, Nascimento…), ajustável ou
   "Ignorar coluna"; prévia das 10 primeiras linhas já interpretadas; resumo válidos novos × já existem (mesmo
   telefone, no cadastro OU nos pedidos) × com erro (telefone inválido, nome vazio, repetido no arquivo) com o motivo
   de cada linha e "Baixar linhas com erro (CSV)"; Ignorar (padrão) / Completar só os vazios / Atualizar; caixa LGPD
   obrigatória; aviso de quem pediu para sair das campanhas (continua fora: as campanhas já excluem os descadastros).
   Telefone sempre no formato do sistema (55 + DDD + número).
3. Importação: lotes de 500 no servidor com barra de progresso; a importação tem uma chave única e cada lote é
   reservado no banco de forma atômica — clique duplo e internet caindo não duplicam (testado derrubando a conexão
   depois de gravar). Resultado com criados/atualizados/ignorados/erros e "Baixar relatório".
- Importados ficam com origem "Importado" e aparecem na lista com 0 pedidos e "Importado (data)" (`05`).
- **Histórico e Desfazer** (`08`): data, usuário, arquivo e quantidades; desfazer em até 7 dias remove os clientes
  criados que ainda não pediram nem entraram na conta, e devolve os atualizados ao valor anterior.
- Isolamento: tudo pela loja da sessão; mesmo telefone em outra loja é outro cliente.

## Modelo de CSV
```
nome;telefone;email;data_nascimento;cep;rua;numero;complemento;bairro;cidade;uf;observacoes
Maria da Silva;(27) 99999-8888;maria@email.com;15/03/1990;29100-000;Rua das Flores;120;Apto 302;Centro;Vila Velha;ES;Prefere sem cebola
João Souza;+55 27 98888-7777;;02/11/1985;;Av. Brasil;45;;Praia da Costa;Vila Velha;ES;
```

## Testes
| Suíte | Resultado |
|---|---|
| `lib/clientes-csv.test.ts` (leitura, codificação, separador, aspas, mapeamento, telefones, datas, erros, arquivos gerados, filtros) | 18/18 |
| `e2e-clientes-csv.mjs` (Chrome, Edge e celular) | 77/77 |
| unitários (todos) | 1894 |
| e2e-equipe-repaginada (permissão nova na tela de Equipe) | 75/75 |

O e2e cobre: cada atalho de período e o personalizado (prévia = linhas do arquivo), cada filtro, planilha completa
(BOM, `;`, acentos, formato brasileiro), Meta Ads igual ao de antes, auditoria; modelo baixado e reimportado; arquivo
do Excel (`;` + Windows-1252, acentos certos); vírgula + UTF-8 com aspas; colunas com nomes diferentes e ajuste
manual; telefones em vários formatos e inválidos; duplicados no arquivo e na base nas 3 opções; download dos erros;
20.000 linhas (12 s) e 20.001 (recusado); arquivo que não é CSV; arrastar e soltar e clique (seletor de arquivos);
clique duplo; conexão caindo; desfazer (atualizados voltam, quem pediu depois fica, desfazer 2× recusado); LGPD;
atendente e garçom sem o botão e com a API recusando; gerente com o botão; outra loja isolada.
Clientes TESTE e importações TESTE são apagados no fim da suíte.

## Publicação (pendente — janela 00:00–10:00)
O código novo lê colunas da 0131 (lista de clientes): aplicar a migration **antes** do deploy.
1. Backup + 0131 em produção (`aplicar-migration-producao.mjs`, conferência das tabelas/colunas/funções).
2. Juntar na main, Redeploy, conferir pelo bundle.
3. Na Menuzia (admin/admin): exportar (planilha e Meta), importar um arquivo TESTE com 2 clientes fictícios, conferir
   a tabela e as métricas, desfazer a importação no histórico.
4. Rollback: desfazer importações pelo painel, `0131_clientes_csv.down.sql`, Redeploy do commit anterior.
