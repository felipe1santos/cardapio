/**
 * Funções de uma impressora (tela v2, 0158) — sem nada de servidor: usado pela tela e pelo
 * serviço. Cozinha e Caixa são as que os modos do Beta usam; a Comanda de entrega é uma via a
 * mais da comanda dos pedidos de entrega (Assistente beta.10+).
 */
export type FuncaoImpressora = 'cozinha' | 'caixa' | 'entrega'
export const FUNCOES_IMPRESSORA: FuncaoImpressora[] = ['cozinha', 'caixa', 'entrega']
export const ehFuncaoImpressora = (v: unknown): v is FuncaoImpressora => v === 'cozinha' || v === 'caixa' || v === 'entrega'
export const ROTULO_FUNCAO_IMPRESSORA: Record<FuncaoImpressora, string> = { cozinha: 'Cozinha', caixa: 'Caixa / pré-conta', entrega: 'Comanda de entrega' }
