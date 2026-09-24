/**
 * Loja e usuários das suítes E2E que semeiam a própria base (semear-demo-mesas.mjs).
 *
 * A semente APAGA itens, categorias, pedidos, comandas e mesas da loja que ela semeia e
 * move os usuários de demonstração para ela. Rodada contra a cantina-demo, levava junto
 * todo dado de teste deixado lá por outras suítes. Com as variáveis abaixo as suítes
 * antigas (garçom, caixa, release de mesas, regressão) rodam numa loja e com usuários só
 * delas, sem mudar nenhum cenário:
 *
 *   E2E_LOJA=cantina-e2e E2E_VIZINHA=vizinha-e2e E2E_SUFIXO=e2e node scripts/seguranca/e2e-garcom.mjs
 *
 * Sem as variáveis, tudo fica como sempre foi (cantina-demo, vizinha-demo, *.local).
 */
const S = process.env.E2E_SUFIXO ?? ''

export const E2E_LOJA = process.env.E2E_LOJA ?? 'cantina-demo'
export const E2E_LOJA_NOME = process.env.E2E_LOJA_NOME ?? (S ? `Cantina E2E` : 'Cantina Demo')
export const E2E_VIZINHA = process.env.E2E_VIZINHA ?? 'vizinha-demo'
export const E2E_VIZINHA_NOME = process.env.E2E_VIZINHA_NOME ?? (S ? `Vizinha E2E` : 'Vizinha Demo')

export const USU = {
  dono: S ? `dono.${S}` : 'dono.local',
  donoEmail: S ? `dono.${S}@local.test` : 'dono@local.test',
  garcom: S ? `garcom.${S}` : 'garcom.local',
  garcomEmail: S ? `garcom.${S}@demo.local` : 'garcom@demo.local',
  atendente: S ? `atendente.${S}` : 'atendente.local',
  atendenteEmail: S ? `atendente.${S}@demo.local` : 'atendente@demo.local',
  donoVizinha: S ? `dono.vizinha.${S}` : 'dono.vizinha',
  donoVizinhaEmail: S ? `dono.${S}@vizinha.local` : 'dono@vizinha.local',
}
