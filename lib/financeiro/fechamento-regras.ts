/**
 * Regras de PIN no fechamento do caixa (Fase 6) — VERSÃO PROVISÓRIA, configurável por loja (fin_config).
 * Pura e testada; quem decide é o servidor (fecharCaixa).
 *
 *   diferença na gaveta até a tolerância (padrão R$ 2,00) → justificativa; acima → PIN de gerente/dono
 *   maquininha com diferença                               → justificativa; acima da tolerância → PIN
 *   motoboy sem acerto                                     → PIN
 *   entregue e não pago                                    → PIN
 *   Pix a conferir                                         → fecha e vai para a lista do dono (sem trava)
 *   mesa/comanda aberta                                    → passa para o próximo turno com justificativa;
 *                                                            PIN acima de R$ 100,00 em aberto
 * O dono nunca precisa de PIN (é ele quem aprovaria); justificativa vale para todos.
 */
export interface ConfigFechamento {
  toleranciaCentavos: number
  limiteComandasCentavos: number
}
export const PADRAO_FECHAMENTO: ConfigFechamento = { toleranciaCentavos: 200, limiteComandasCentavos: 10000 }

export interface SituacaoFechamento {
  diferencaDinheiro: number
  diferencaCartao: number
  motoboysSemAcerto: number
  entreguesNaoPagos: number
  pixAConferirCentavos: number
  comandasAbertas: number
  comandasAbertasCentavos: number
}

export type Motivo =
  | 'diferenca_dinheiro' | 'diferenca_dinheiro_acima' | 'diferenca_cartao' | 'diferenca_cartao_acima'
  | 'motoboy_sem_acerto' | 'entregue_nao_pago' | 'comandas_abertas' | 'comandas_abertas_acima'

export interface Exigencias {
  justificativa: boolean
  pin: boolean
  /** O que levou a cada exigência (para a tela explicar). */
  motivos: Motivo[]
  /** Pix a conferir não trava: só vai para a lista do dono. */
  pixParaODono: boolean
}

export const TEXTO_MOTIVO: Record<Motivo, string> = {
  diferenca_dinheiro: 'Diferença no dinheiro da gaveta: explique.',
  diferenca_dinheiro_acima: 'Diferença no dinheiro acima da tolerância: precisa do PIN de um gerente.',
  diferenca_cartao: 'Diferença na maquininha: explique.',
  diferenca_cartao_acima: 'Diferença na maquininha acima da tolerância: precisa do PIN de um gerente.',
  motoboy_sem_acerto: 'Motoboy sem acerto: precisa do PIN de um gerente.',
  entregue_nao_pago: 'Entrega marcada como não paga: precisa do PIN de um gerente.',
  comandas_abertas: 'Mesa/comanda aberta passa para o próximo turno: explique.',
  comandas_abertas_acima: 'Mais de R$ 100,00 em mesas/comandas abertas: precisa do PIN de um gerente.',
}

export function exigenciasDoFechamento(s: SituacaoFechamento, cfg: ConfigFechamento, papel: string): Exigencias {
  const m: Motivo[] = []
  if (s.diferencaDinheiro !== 0) m.push(Math.abs(s.diferencaDinheiro) > cfg.toleranciaCentavos ? 'diferenca_dinheiro_acima' : 'diferenca_dinheiro')
  if (s.diferencaCartao !== 0) m.push(Math.abs(s.diferencaCartao) > cfg.toleranciaCentavos ? 'diferenca_cartao_acima' : 'diferenca_cartao')
  if (s.motoboysSemAcerto > 0) m.push('motoboy_sem_acerto')
  if (s.entreguesNaoPagos > 0) m.push('entregue_nao_pago')
  if (s.comandasAbertas > 0) m.push(s.comandasAbertasCentavos > cfg.limiteComandasCentavos ? 'comandas_abertas_acima' : 'comandas_abertas')
  const pedePin = m.some((x) => x.endsWith('_acima') || x === 'motoboy_sem_acerto' || x === 'entregue_nao_pago')
  return {
    // Toda diferença ou pendência pede uma explicação escrita; PIN, só nos casos acima.
    justificativa: m.length > 0,
    pin: pedePin && papel !== 'dono',
    motivos: m,
    pixParaODono: s.pixAConferirCentavos > 0,
  }
}
