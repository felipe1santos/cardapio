import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'fs'
import { join } from 'path'
import { GRUPOS_EVENTO, ROTULO_EVENTO, resumoEvento, rotuloEvento } from './auditoria'
import { PERMISSOES } from '@/lib/auth/permissoes'

const raiz = join(__dirname, '..', '..')

function arquivos(dir: string, acc: string[] = []): string[] {
  for (const nome of readdirSync(dir)) {
    if (nome === 'node_modules' || nome === '.next' || nome === '.git') continue
    const caminho = join(dir, nome)
    if (statSync(caminho).isDirectory()) arquivos(caminho, acc)
    else if (/\.(ts|tsx|sql)$/.test(nome) && !nome.endsWith('.test.ts')) acc.push(caminho)
  }
  return acc
}

/**
 * Toda ação que alguém grava na trilha precisa de rótulo em português — senão a tela de
 * auditoria mostra `conta.cancelou_comanda` para o dono. Este teste varre o código e as
 * migrations procurando as ações realmente gravadas e cobra o rótulo de cada uma.
 */
function acoesGravadas(): string[] {
  const achadas = new Set<string>()
  for (const caminho of arquivos(raiz)) {
    const fonte = readFileSync(caminho, 'utf8')
    // TypeScript: `acao: 'x.y'` e `acoes.push('x.y')`
    for (const m of fonte.matchAll(/ac(?:ao|oes\.push\()\s*:?\s*'([a-z_]+\.[a-z_]+)'/g)) achadas.add(m[1]!)
    // SQL: as funções da 0067/0068/0070 gravam auditoria com o nome literal
    for (const m of fonte.matchAll(/'((?:mesa|mesas|conta|chamado|equipe)\.[a-z_]+)'/g)) achadas.add(m[1]!)
  }
  // `mesas.operar`, `equipe.gerenciar` e afins casam com o mesmo formato mas são
  // PERMISSÕES, não eventos gravados. A matriz é a lista canônica delas.
  const permissoes = new Set<string>(PERMISSOES)
  return [...achadas].filter((a) => !permissoes.has(a)).sort()
}

describe('rótulos da auditoria', () => {
  it('toda ação gravada no código tem rótulo legível', () => {
    const semRotulo = acoesGravadas().filter((a) => !(a in ROTULO_EVENTO))
    expect(semRotulo, `sem rótulo em ROTULO_EVENTO: ${semRotulo.join(', ')}`).toEqual([])
  })

  it('todo rótulo cai em algum grupo do filtro — nada fica invisível na tela', () => {
    const prefixos = GRUPOS_EVENTO.flatMap((g) => g.prefixos)
    for (const acao of Object.keys(ROTULO_EVENTO)) {
      expect(prefixos.some((p) => acao.startsWith(p)), acao).toBe(true)
    }
  })

  it('ação desconhecida aparece com o código, não em branco', () => {
    expect(rotuloEvento('coisa.nova')).toBe('coisa.nova')
  })
})

describe('resumo do evento', () => {
  it('monta a frase com mesa, transição, resumo e motivo', () => {
    expect(resumoEvento({ mesa: 'Mesa 4', de: 'aberta', para: 'cancelada', motivo: 'cliente desistiu' })).toBe(
      'Mesa 4 · aberta → cancelada · cliente desistiu',
    )
  })

  it('não repete o motivo quando ele já é o resumo', () => {
    expect(resumoEvento({ resumo: 'queimou', motivo: 'queimou' })).toBe('queimou')
  })

  it('transição só aparece completa: só "de" sem "para" não vira frase quebrada', () => {
    expect(resumoEvento({ de: 'aberta' })).toBe('')
  })

  it('eventos de equipe mostram quem foi mexido e o papel novo', () => {
    expect(resumoEvento({ alvo: 'Ana', papelNovo: 'garcom' })).toBe('Ana · garcom')
    expect(resumoEvento({ nome: 'Bruno', papel: 'atendente' })).toBe('Bruno · atendente')
  })

  it('dados vazios ou com tipos estranhos não quebram nem vazam objeto na tela', () => {
    expect(resumoEvento({})).toBe('')
    expect(resumoEvento({ mesa: 3, de: {}, resumo: '   ' })).toBe('')
  })
})
