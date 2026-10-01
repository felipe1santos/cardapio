# Dashboard — filtro de data compacto, aviso em ⓘ e padrão de 30 dias (2026-10-01)

- Filtro de período com a largura do conteúdo (340 px, calendário junto do texto), à esquerda no topo;
  no celular ocupa a linha. Funcionamento igual (atalhos e datas soltas).
- A faixa azul "Visitas, visualizações, sacola e checkout são contadas a partir da ativação do rastreio…"
  saiu; o texto está no ⓘ ao lado do filtro (passar o mouse ou tocar). O aviso laranja de "rastreio ainda
  não ativado" continua como estava.
- Período padrão ao abrir: **últimos 30 dias** (antes 7). Só muda quando o usuário escolhe outro.
- Cards e gráficos sem mudança de código. Com 30 dias, o "período anterior" (30 dias antes) cai antes da
  ativação do rastreio da vitrine (23/09) — por isso o funil mostra "sem comparação" até haver 60 dias de dados.

Prints em `prints/antes` e `prints/depois` (desktop 1366×768, tablet 820×1180, celular 390×844), gerados por
`scripts/dashboard/prints-filtro.mjs`, que também confere largura, padrão de 30 dias, troca para 7 dias e o ⓘ.
