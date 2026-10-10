# Decisões da noite — 10/10/2026 (trabalho autônomo, dono ausente)

Regra da noite: toda novidade VISÍVEL fica atrás da chave por loja **"Novidades em teste"**
(`restaurantes.novidades_teste`, migração 0178), ligada só na Menuzia. Sem a chave, tudo como antes.

## Bloco 0 — menus

| # | Decisão | Por quê |
|---|---|---|
| N1 | A chave mora em `restaurantes.novidades_teste` e chega ao painel pelo `/api/sessao/estado` (`novidades`). | Uma leitura que o painel já faz; nenhum pedido a mais. |
| N2 | A reorganização de menus (publicada para todas às 23:28, commit 07ac8ee) foi para trás da chave às 23:46 (2bb3c7b). Lojas reais voltaram ao menu de antes. | Ordem do dono: novidades só na Menuzia. |
| N3 | Links do painel (ícone de impressora, alertas, PDV, Fidelidade) voltaram aos endereços antigos; com a chave, as páginas antigas levam às novas. | Sem a chave, nenhuma tela nova aparece nem de passagem. |
| N4 | Para conferir "como uma loja real vê", desliguei a chave **só da Menuzia** por alguns minutos e religuei. | Não tenho (nem devo ter) a senha de loja real; a Menuzia sem a chave é idêntica. |
| N5 | **Bug achado na conferência:** sem a chave, Agente de IA e Impressão ficaram sem ícone no menu (a reorganização tinha tirado os desenhos). Corrigido em fa87fd1 + teste "todo item do menu tem ícone". | — |
| N6 | Super Admin: coluna e ação "Novidades em teste" por loja; "Liberar novidades para todas" pede LIBERAR digitado. Tudo na auditoria da loja e da plataforma. | Igual ao padrão do "Excluir dados" e do Beta da impressão. |
| N7 | O módulo Disparos está bloqueado na Menuzia desde 22:38 (ação do dono no Super Admin). Não religuei. | Decisão do dono. |
