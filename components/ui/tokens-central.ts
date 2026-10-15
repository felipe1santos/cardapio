/**
 * Tokens da CENTRAL DO WHATSAPP (components/atendimento/central.tsx), extraídos em 15/10/2026 para o Kanban v3 e
 * qualquer tela que siga o mesmo padrão. Os valores são os da central; mudar aqui não muda a central (ela tem os dela).
 *
 * Fonte: a do painel (Mulish, var(--font-painel)) — a central herda, não define outra.
 */
export const FONTE_CENTRAL = { fontFamily: 'var(--font-painel), Mulish, system-ui, sans-serif' } as const

/** Cores (hex) dos tokens, para estilo inline e para o guia. */
export const COR = {
  verdeFundo: '#ECFDF5', verdeTexto: '#047857', verdeEscuro: '#047857', verdeEscuroHover: '#065F46',
  azulFundo: '#DBEAFE', azulTexto: '#1D4ED8', azul: '#0688D4', azulHover: '#0570AE',
  novoFundo: '#FEF3C7', novoFundoForte: '#FDE68A', novoBorda: '#FCD34D', novoFaixa: '#F59E0B', ambarTexto: '#92400E',
  vermelhoFundo: '#FEF2F2', vermelhoBorda: '#FECACA', vermelhoTexto: '#B91C1C',
  borda: '#E5E7EB', bordaForte: '#D1D5DB', fundoCinza: '#F9FAFB', texto: '#111827', textoMedio: '#4B5563', textoSuave: '#6B7280',
} as const

/** Selo em pílula (o "Robô ativo" / "Em atendimento" da central): 11,5px/600, px 8, py 2. */
const SELO = 'inline-flex items-center gap-[4px] whitespace-nowrap rounded-full px-[8px] py-[2px] text-[11.5px] font-semibold leading-[16px]'
export const SELO_VERDE = `${SELO} bg-[#ECFDF5] text-[#047857]`
export const SELO_AZUL = `${SELO} bg-[#DBEAFE] text-[#1D4ED8]`
export const SELO_AMBAR = `${SELO} bg-[#FEF3C7] text-[#92400E]`
export const SELO_VERMELHO = `${SELO} bg-[#FEF2F2] text-[#B91C1C]`
export const SELO_CINZA = `${SELO} bg-[#F3F4F6] text-[#4B5563]`

/** Botões da central: cantos 8px, 12,5px/600. Primário verde-escuro = "Resolvido". */
const BOTAO = 'inline-flex items-center justify-center gap-[6px] whitespace-nowrap rounded-[8px] font-semibold transition-colors disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0688D4]'
export const BOTAO_VERDE = `${BOTAO} bg-[#047857] text-white hover:bg-[#065F46]`
export const BOTAO_AZUL = `${BOTAO} bg-[#0688D4] text-white hover:bg-[#0570AE]`
export const BOTAO_CONTORNO = `${BOTAO} border border-[#D1D5DB] bg-white text-[#1F2937] hover:border-[#0688D4] hover:text-[#0688D4]`
export const BOTAO_PERIGO = `${BOTAO} border border-[#FECACA] bg-white text-[#B91C1C] hover:bg-[#FEF2F2]`

/** Destaque de "novo / precisa de atenção" (conversa pedindo atendente): amarelo com faixa laranja à esquerda. */
export const DESTAQUE_NOVO = 'border-[#FCD34D] bg-[#FEF3C7]'
export const FAIXA_NOVO = '#F59E0B'

/** Atraso: texto vermelho sobre vermelho-claro. */
export const ATRASO = 'bg-[#FEF2F2] text-[#B91C1C]'

export const SELO_POR_TOM = { verde: SELO_VERDE, azul: SELO_AZUL, ambar: SELO_AMBAR } as const
