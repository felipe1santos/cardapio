import { describe, it, expect } from 'vitest'
import { avisoDriver, envioDiretoSugerido, papelDoDriver, ehIpv4, perfilEnvio, validarPerfilEnvio, PERFIL_ENVIO_PADRAO } from './regras-calibracao'

describe('perfil de envio da impressora (0109)', () => {
  it('padrão = comportamento de sempre (driver, imagem, normal)', () => {
    expect(perfilEnvio(null)).toEqual({ intensidade: 'normal', envio: 'driver', modoImpressao: 'imagem', redeIp: null, redePorta: 9100 })
    expect(perfilEnvio({ intensidade: 'x', envio: 'y', modo_impressao: 'z', rede_ip: '999.1.1.1', rede_porta: 0 })).toEqual(PERFIL_ENVIO_PADRAO)
    expect(perfilEnvio({ intensidade: 'escura', envio: 'raw_rede', modo_impressao: 'texto', rede_ip: '192.168.0.50', rede_porta: 9100 }))
      .toEqual({ intensidade: 'escura', envio: 'raw_rede', modoImpressao: 'texto', redeIp: '192.168.0.50', redePorta: 9100 })
  })

  it('IPv4', () => {
    for (const ok of ['192.168.0.50', '10.0.0.1', '0.0.0.0', '255.255.255.255']) expect(ehIpv4(ok)).toBe(true)
    for (const ruim of ['192.168.0', '256.1.1.1', '01.2.3.4', 'a.b.c.d', '192.168.0.50:9100', '']) expect(ehIpv4(ruim)).toBe(false)
  })

  it('valida e converte para as colunas do banco', () => {
    expect(validarPerfilEnvio({ intensidade: 'mais_escura' })).toEqual({ ok: true, patch: { intensidade: 'mais_escura' } })
    expect(validarPerfilEnvio({ envio: 'raw_rede', redeIp: '192.168.0.50', redePorta: 9100 })).toEqual({ ok: true, patch: { envio: 'raw_rede', rede_ip: '192.168.0.50', rede_porta: 9100 } })
    expect(validarPerfilEnvio({ modoImpressao: 'texto' })).toEqual({ ok: true, patch: { modo_impressao: 'texto' } })
    expect(validarPerfilEnvio({ intensidade: 'forte' }).ok).toBe(false)
    expect(validarPerfilEnvio({ redeIp: '1.2.3' }).ok).toBe(false)
    expect(validarPerfilEnvio({ redePorta: 70000 }).ok).toBe(false)
  })

  it('pela rede exige IP (o que vem agora ou o que já estava salvo)', () => {
    expect(validarPerfilEnvio({ envio: 'raw_rede' })).toMatchObject({ ok: false })
    expect(validarPerfilEnvio({ envio: 'raw_rede' }, { ...PERFIL_ENVIO_PADRAO, redeIp: '192.168.0.9' }).ok).toBe(true)
    expect(validarPerfilEnvio({ redeIp: null }, { ...PERFIL_ENVIO_PADRAO, envio: 'raw_rede', redeIp: '192.168.0.9' }).ok).toBe(false)
  })
})

describe('aviso de driver com largura diferente', () => {
  const base = { larguraMm: 80, larguraPontos: null }
  it('driver de 58 mm numa impressora de 80 mm (POS-8370 do cliente)', () => {
    expect(avisoDriver({ ...base, diagnostico: { papelLarguraMm: 58, pontosImprimiveis: 384 } })).toBe('Seu driver está em 58 mm, mas a impressora é de 80 mm. A comanda sai cortada à direita.')
  })
  it('papel certo, mas área imprimível menor que a comanda', () => {
    expect(avisoDriver({ ...base, diagnostico: { papelLarguraMm: 80, pontosImprimiveis: 512 } })).toContain('só imprime 512 pontos')
    expect(avisoDriver({ ...base, larguraPontos: 512, diagnostico: { papelLarguraMm: 80, pontosImprimiveis: 512 } })).toBeNull()
  })
  it('tudo certo, sem diagnóstico ou envio direto: sem aviso', () => {
    expect(avisoDriver({ ...base, diagnostico: { papelLarguraMm: 80, pontosImprimiveis: 576 } })).toBeNull()
    expect(avisoDriver({ ...base, diagnostico: null })).toBeNull()
    // Sem o papel declarado: os pontos do driver dizem o papel efetivo (384 = 58 mm).
    expect(avisoDriver({ ...base, diagnostico: { pontosImprimiveis: 384 } })).toBe('Seu driver está em 58 mm, mas a impressora é de 80 mm. A comanda sai cortada à direita.')
    expect(papelDoDriver({ pontosImprimiveis: 576 })).toBe(80)
    expect(papelDoDriver({})).toBeNull()
    expect(envioDiretoSugerido({ redeIp: '192.168.0.50' })).toBe('raw_rede')
    expect(envioDiretoSugerido({ redeIp: null })).toBe('raw_fila')
    expect(avisoDriver({ ...base, envio: 'raw_fila', diagnostico: { papelLarguraMm: 58, pontosImprimiveis: 384 } })).toBeNull()
  })
})
