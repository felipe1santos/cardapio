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
  // Funcionário cadastrado pela tela no e2e-checkpoint-e (login é único no sistema inteiro).
  funcionarioNovo: S ? `maria.garcom.${S}` : 'maria.garcom',
}

/**
 * Trava das suítes que semeiam a loja: só rodam numa loja isolada, com usuários próprios.
 * Sem isso, a semente apagaria os dados de teste da cantina-demo/vizinha-demo.
 */
export function exigirLojaIsolada() {
  if (!S || ['cantina-demo', 'vizinha-demo'].includes(E2E_LOJA) || ['cantina-demo', 'vizinha-demo'].includes(E2E_VIZINHA)) {
    console.error('Esta suíte semeia (e APAGA dados de) a loja de teste. Rode numa loja isolada, por exemplo:\n'
      + '  E2E_LOJA=cantina-e2e E2E_VIZINHA=vizinha-e2e E2E_SUFIXO=e2e node <script>')
    process.exit(2)
  }
}
