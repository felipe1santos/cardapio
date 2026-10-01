# Clientes — botão CSV (importar e exportar) — progresso

Branch `feat/clientes-csv` (a partir da main 93440d6). Item só é marcado depois de testado.

- [x] Migration 0131 (campos novos em clientes, origem "importado", histórico, alterações para desfazer, conferência de telefones, reserva atômica de lote) — aplicada no local
- [x] Regras puras `lib/clientes-csv.ts` + 18 unitários
- [x] Permissão "Importar/exportar clientes" (dono e gerente por padrão; com acessos próprios precisa marcar) — tela, middleware e rotas
- [x] Botão "CSV ▾": Importar clientes / Exportar clientes / Histórico de importações
- [x] Modal Exportar: atalhos de período + personalizado, última compra × cadastro, 3 filtros, prévia ao vivo, Planilha completa e Meta Ads, auditoria
- [x] Modal Importar: modelo + baixar modelo, área de arrastar/clicar, limites, detecção (separador, codificação, cabeçalho), mapeamento ajustável, prévia, resumo, erros + download, 3 modos, LGPD, lotes idempotentes com barra, resultado + relatório
- [x] Lista: importados com 0 pedidos e "Importado (data)"; Compraram 1x/Recorrentes/Ticket médio sem mudança; total inclui
- [x] Histórico e Desfazer (7 dias; quem pediu depois fica; atualizados voltam)
- [x] "Salvo" global não aparece na conferência/exportação
- [x] E2E e2e-clientes-csv 77/77 (Chrome, Edge e celular); regressão: unitários 1894, equipe 75/75
- [ ] Publicação (janela 00:00–10:00): backup + 0131 ANTES do código; conferência na Menuzia
