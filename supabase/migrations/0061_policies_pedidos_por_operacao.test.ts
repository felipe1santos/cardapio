import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const aqui = dirname(fileURLToPath(import.meta.url))
const pedidos = readFileSync(join(aqui, '0061_policies_pedidos_por_operacao.sql'), 'utf8')
const salao = readFileSync(join(aqui, '0062_policies_salao_equipe_auditoria.sql'), 'utf8')
const tudo = pedidos + '\n' + salao

/** Só os comandos: os comentários citam padrões proibidos justamente para explicá-los. */
const semComentarios = (texto: string) =>
  texto
    .split('\n')
    .filter((l) => !l.trim().startsWith('--'))
    .join('\n')

describe('0061/0062 — policies por operação', () => {
  it('nenhuma policy nova usa FOR ALL', () => {
    const criadas = tudo.match(/create policy[\s\S]*?(?=;)/g) ?? []
    expect(criadas.length).toBeGreaterThan(0)
    for (const p of criadas) expect(p).not.toMatch(/\bfor all\b/i)
  })

  it('derruba as policies FOR ALL antigas', () => {
    expect(pedidos).toMatch(/drop policy if exists "Tenant members manage pedidos" on public\.pedidos/)
    expect(pedidos).toMatch(/drop policy if exists "Tenant members manage pedido_itens" on public\.pedido_itens/)
    expect(salao).toMatch(/drop policy if exists mesas_tenant_rw on public\.mesas/)
    expect(salao).toMatch(/drop policy if exists comandas_tenant_rw on public\.comandas/)
    expect(salao).toMatch(/drop policy if exists "Tenant members manage clientes" on public\.clientes/)
  })

  it('usa allowlist de papéis, nunca negação', () => {
    // `<> 'garcom'` daria acesso automático a qualquer papel futuro.
    expect(semComentarios(tudo)).not.toMatch(/auth_papel\(\)\s*(<>|!=|is distinct from)/)
    expect(semComentarios(tudo)).toMatch(/auth_papel\(\) in \(/)
  })

  /** Extrai `canal -> papéis` do `case` de uma policy. */
  function papeisPorCanal(sql: string, policy: string): Record<string, string[]> {
    const corpo = sql.split(`create policy ${policy}`)[1].split(';')[0]
    const mapa: Record<string, string[]> = {}
    for (const [, canal, lista] of corpo.matchAll(/when '(\w+)'\s+then public\.auth_papel\(\) in \(([^)]*)\)/g)) {
      mapa[canal] = lista.split(',').map((p) => p.trim().replace(/'/g, ''))
    }
    return mapa
  }

  it('a leitura é decidida por canal, com allowlist em cada um', () => {
    const porCanal = papeisPorCanal(pedidos, 'pedidos_select')
    expect(porCanal.mesa.sort()).toEqual(['cozinha', 'dono', 'garcom', 'gerente'])
    expect(porCanal.delivery.sort()).toEqual(['atendente', 'dono', 'gerente', 'logistica'])
    expect(porCanal.balcao.sort()).toEqual(['atendente', 'dono', 'gerente'])
  })

  it('garçom não alcança delivery nem balcão; atendente e logística não alcançam a mesa', () => {
    const porCanal = papeisPorCanal(pedidos, 'pedidos_select')
    expect(porCanal.delivery).not.toContain('garcom')
    expect(porCanal.balcao).not.toContain('garcom')
    expect(porCanal.mesa).not.toContain('atendente')
    expect(porCanal.mesa).not.toContain('logistica')
  })

  it('canal desconhecido nega por padrão', () => {
    // Canal novo nasce invisível até alguém decidir quem o vê.
    const corpo = pedidos.split('create policy pedidos_select')[1].split(';')[0]
    expect(corpo).toMatch(/else false/)
  })

  it('no canal mesa o garçom não avança preparo — isso é da cozinha', () => {
    const porCanal = papeisPorCanal(pedidos, 'pedidos_update')
    expect(porCanal.mesa.sort()).toEqual(['cozinha', 'dono', 'gerente'])
    expect(porCanal.mesa).not.toContain('garcom')
  })

  it('ninguém insere nem apaga pedido pelo navegador', () => {
    expect(pedidos).not.toMatch(/create policy[^;]*on public\.pedidos\s*\n?\s*for (insert|delete)/i)
    expect(pedidos).toMatch(/revoke insert, update, delete on public\.pedido_itens from authenticated/)
  })

  it('preço, total, desconto, pago, canal e comanda ficam fora do UPDATE do navegador', () => {
    const grant = pedidos.match(/grant update \(([\s\S]*?)\) on public\.pedidos to authenticated/)
    expect(grant).not.toBeNull()
    const cols = grant![1].split(',').map((c) => c.replace(/--.*$/gm, '').trim()).filter(Boolean)
    for (const proibida of ['total', 'subtotal', 'desconto', 'taxa_entrega', 'pago', 'canal', 'origem', 'comanda_id', 'restaurante_id']) {
      expect(cols).not.toContain(proibida)
    }
    // As sete que o Kanban, a Logística e a fila de impressão realmente escrevem.
    expect(cols.sort()).toEqual(
      ['entregador_id', 'impresso', 'preparado_por', 'preparando_notificado', 'preparando_por', 'reimprimir', 'status'].sort(),
    )
    // O revoke precisa vir antes do grant, senão o grant é apagado em seguida.
    expect(pedidos.indexOf('revoke update on public.pedidos from authenticated'))
      .toBeLessThan(pedidos.indexOf('grant update ('))
  })

  it('garçom não alcança clientes do delivery', () => {
    const select = salao.split('create policy clientes_select')[1].split(';')[0]
    expect(select).toMatch(/auth_papel\(\) in \('dono', 'gerente', 'atendente'\)/)
    expect(select).not.toContain('garcom')
  })

  it('mesa não se apaga e só a gestão configura', () => {
    expect(salao).not.toMatch(/create policy[^;]*on public\.mesas\s*\n?\s*for delete/i)
    expect(salao).toMatch(/create policy mesas_insert[\s\S]*?auth_e_gestor\(\)/)
    expect(salao).toMatch(/create policy mesas_update[\s\S]*?auth_e_gestor\(\)/)
  })

  it('comanda só é escrita pelo servidor', () => {
    expect(salao).toMatch(/revoke insert, update, delete on public\.comandas from authenticated/)
  })

  it('usuarios entrega só as colunas públicas mínimas', () => {
    const grant = salao.match(/grant select \(([^)]*)\) on public\.usuarios to authenticated/)
    expect(grant).not.toBeNull()
    const cols = grant![1].split(',').map((c) => c.trim())
    expect(cols.sort()).toEqual(['desativado_em', 'id', 'nome', 'papel', 'restaurante_id'].sort())
    for (const sensivel of ['email', 'usuario', 'telefone', 'autorizado', 'acesso_expira_em', 'logins_total']) {
      expect(cols).not.toContain(sensivel)
    }
    expect(salao.indexOf('revoke select on public.usuarios from authenticated'))
      .toBeLessThan(salao.indexOf('grant select (id, restaurante_id, papel, nome, desativado_em)'))
  })

  it('auditoria é append-only e só gestor lê', () => {
    expect(salao).toMatch(/create policy auditoria_gestor_ro[\s\S]*?auth_e_gestor\(\)/)
    expect(salao).toMatch(/revoke all on public\.eventos_auditoria from authenticated/)
    expect(salao).toMatch(/grant select on public\.eventos_auditoria to authenticated/)
    expect(salao).toMatch(/revoke all on public\.eventos_auditoria from anon/)
    // Nenhum grant de escrita para a aplicação.
    expect(salao).not.toMatch(/grant (insert|update|delete)[^;]*eventos_auditoria/)
  })
})
