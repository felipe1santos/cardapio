import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { PUBLICOS } from '@/lib/mensageria/recorrentes'

/** 04/11/2026: Disparos v2 — anúncios (Promoções / Disparo personalizado), copies da Recuperação, 13 públicos. */
const sql = readFileSync('supabase/migrations/0248_disparos_anuncios.sql', 'utf8')
const trecho = (de: string, ate?: string) => sql.slice(sql.indexOf(de), ate ? sql.indexOf(ate, sql.indexOf(de) + de.length) : undefined)

describe('0248 anúncios', () => {
  it('tabela com RLS de gestor (select envolvido) e o painel não grava agenda nem última rodada', () => {
    expect(sql).toMatch(/alter table public\.campanha_recorrente_anuncios enable row level security/)
    expect(sql).toMatch(/restaurante_id = \(select public\.auth_restaurante_id\(\)\) and \(select public\.auth_e_gestor\(\)\)/)
    const grant = sql.match(/grant update \(([^)]*)\) on public\.campanha_recorrente_anuncios to authenticated/)
    expect(grant).toBeTruthy()
    for (const c of ['proximo_disparo_em', 'ultima_rodada_em', 'ultima_campanha_id', 'ultima_rodada_motivo', 'imagem_indice', 'restaurante_id']) expect(grant![1]).not.toContain(c)
  })

  it('índice parcial dos vencidos (o cron só lê o que venceu)', () => {
    expect(sql).toMatch(/on public\.campanha_recorrente_anuncios \(proximo_disparo_em\) where proximo_disparo_em is not null/)
  })

  it('trigger do anúncio: dono vem do card, até 5, promoção com 1 imagem, incompleto fica sem agenda', () => {
    const fn = trecho('function public.campanha_recorrente_anuncios_fn()', 'end $$;')
    expect(fn).toMatch(/new\.restaurante_id := v_card\.restaurante_id/)
    expect(fn).toMatch(/>= 5 then/)
    expect(fn).toMatch(/v_card\.tipo = 'promocoes' and jsonb_array_length\(new\.imagens\) > 1/)
    expect(fn).toMatch(/jsonb_array_length\(new\.imagens\) > 0 and btrim\(new\.mensagem\) <> ''/)
    expect(fn).toMatch(/v_card\.tipo <> 'nunca_compraram' or cardinality\(new\.publicos\) > 0/)
  })

  it('card de anúncios só liga com pelo menos 1 anúncio e todos completos', () => {
    const fn = trecho('function public.campanha_recorrentes_agenda_fn()', 'end $$;')
    expect(fn).toMatch(/crie pelo menos 1 anúncio para ligar o card/)
    expect(fn).toMatch(/há anúncio incompleto/)
    expect(fn).toMatch(/o card precisa de pelo menos 1 copy para ligar/)
  })

  it('os 13 públicos do banco são os mesmos da tela', () => {
    const bate = trecho('function public.campanha_publico_bate(', '$$;')
    for (const p of PUBLICOS) {
      expect(bate).toContain(`when '${p.chave}'`)
      expect(sql).toContain(`'${p.chave}'`)
    }
    expect(bate).toMatch(/select p_n > 0 and case/)
    expect(bate).not.toMatch(/\bimmutable\b/)
  })

  it('base do público: fora SAIR e fora quem já entrou em rodada hoje; funções internas só service_role', () => {
    const base = trecho('function public.campanha_publico_base(', '$$;')
    expect(base).toMatch(/whatsapp_descadastros/)
    expect(base).toMatch(/e\.criado_em >= hoje\.inicio/)
    for (const f of ['campanha_publico_base(uuid)', 'campanha_recorrente_publico(uuid, text, text[])', 'campanha_recorrentes_gerar_rodadas()']) {
      expect(sql).toMatch(new RegExp(`revoke execute on function public\\.${f.replace(/[()[\]]/g, '\\$&')} from public, anon, authenticated`))
    }
  })

  it('tela: tamanhos e estimativa só para gestor da própria loja', () => {
    for (const f of ['campanha_publicos_tamanhos()', 'campanha_publico_estimativa(', 'campanha_recorrente_estimativa(']) {
      expect(trecho(`function public.${f}`, 'end $$;')).toMatch(/not public\.auth_e_gestor\(\) then raise exception 'sem permissão' using errcode = '42501'/)
    }
  })

  it('rodada: aquecimento primeiro (limite_dia), quem nunca recebeu antes, sem público apaga a campanha', () => {
    const rod = trecho('function public.campanha_recorrente_criar_rodada(', 'end $$;')
    expect(rod).toMatch(/v_resta := public\.campanha_recorrente_limite_aquecimento\(p_restaurante\)/)
    expect(rod).toMatch(/motivo := 'limite_dia'/)
    expect(rod).toMatch(/order by p\.ultimo_disparo_em nulls first, random\(\)/)
    expect(rod).toMatch(/delete from public\.campanhas where id = v_campanha/)
  })

  it('cota do dia dividida entre os disparos que ainda saem hoje (contados antes de avançar a agenda)', () => {
    const rod = trecho('function public.campanha_recorrente_criar_rodada(', 'end $$;')
    expect(rod).toMatch(/v_resta := ceil\(v_resta::numeric \/ greatest\(1, coalesce\(p_dividir, 1\)\)\)::int/)
    const g = trecho('function public.campanha_recorrentes_gerar_rodadas()', 'end $$;')
    expect(g.match(/v_dividir := public\.campanha_recorrente_pendentes_hoje\(v\.restaurante_id\);/g)?.length).toBe(2)
    expect(g.match(/v\.disparo_limite_dia, v_dividir\)/g)?.length).toBe(2)
    for (const loop of g.split('for v in').slice(1)) expect(loop.indexOf('v_dividir :=')).toBeLessThan(loop.indexOf('set proximo_disparo_em'))
    expect(sql).toMatch(/revoke execute on function public\.campanha_recorrente_pendentes_hoje\(uuid\) from public, anon, authenticated/)
  })

  it('gerar rodadas: trava com skip locked, avança a agenda antes de criar, pula anúncio incompleto e módulo desligado', () => {
    const g = trecho('function public.campanha_recorrentes_gerar_rodadas()', 'end $$;')
    expect(g.match(/for update of [ac] skip locked/g)?.length).toBe(2)
    expect(g.match(/m\.modulo = 'disparos' and m\.liberado/g)?.length).toBe(2)
    expect(g).toMatch(/and jsonb_array_length\(a\.imagens\) > 0 and btrim\(a\.mensagem\) <> ''/)
    // a agenda avança antes da rodada (sem repetir no próximo minuto)
    expect(g.indexOf('update public.campanha_recorrente_anuncios set proximo_disparo_em')).toBeLessThan(g.indexOf('campanha_recorrente_criar_rodada(v.restaurante_id, v.recorrente_id'))
    expect(g).toMatch(/v_agora_sp::time > v\.janela_fim/)
  })

  it('Recuperação: copies em rodízio; sem copies usa a mensagem antiga (card ligado em produção segue igual)', () => {
    const g = trecho('function public.campanha_recorrentes_gerar_rodadas()', 'end $$;')
    expect(g).toMatch(/offset \(v\.mensagem_indice % v_n_msg\)/)
    expect(g).toMatch(/else coalesce\(nullif\(v_img_obj ->> 'mensagem', ''\), v\.mensagem\) end/)
    expect(sql).toMatch(/jsonb_array_length\(imagens\) <= 6/)
    expect(sql).toMatch(/jsonb_array_length\(mensagens\) <= 5/)
  })
})
