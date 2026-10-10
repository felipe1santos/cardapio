import type { ItemSubmenu } from '@/components/admin/submenu-vertical'

/**
 * Seções de Ajustes (submenu). Reorganização 10/10/2026 (ordem do dono):
 *  - Impressão saiu do menu principal e virou item daqui (página própria /admin/ajustes/impressao, mesma
 *    permissão de antes: dono e gerente).
 *  - Agente de IA saiu do menu principal e fica logo abaixo do Robô de atendimento (cadeado sem o módulo).
 *  - "Modelos de mensagem" e "Notificações do app" foram para Campanhas (são das campanhas, para clientes).
 */
export type AbaAjustes = 'loja' | 'entrega' | 'mesas' | 'qrcode' | 'conta' | 'impressao' | 'mensagens' | 'robo' | 'agente'

export const HREF_IMPRESSAO = '/admin/ajustes/impressao'

/** Abas antigas que mudaram de lugar → para onde vão. */
export const ABAS_MOVIDAS: Record<string, string> = {
  impressao: HREF_IMPRESSAO,
  cozinha: '/admin/cozinha',
  modelos: '/admin/campanhas?aba=modelos',
  notificacoes: '/admin/campanhas?aba=notificacoes',
}

export function abasDoAjustes(o: { podeAjustes: boolean; podeImpressao: boolean; agenteLiberado: boolean }): ItemSubmenu<AbaAjustes>[] {
  const todas: ItemSubmenu<AbaAjustes>[] = [
    { id: 'loja', label: 'Perfil da loja', icone: 'store' },
    { id: 'entrega', label: 'Entrega', icone: 'delivery_dining' },
    { id: 'mesas', label: 'Mesas', icone: 'table_restaurant' },
    { id: 'qrcode', label: 'QR Code', icone: 'qr_code_2' },
    { id: 'conta', label: 'Conta', icone: 'manage_accounts' },
    { id: 'impressao', label: 'Impressão', icone: 'print' },
    { id: 'mensagens', label: 'Mensagens automáticas', icone: 'chat', grupo: 'WhatsApp e notificações' },
    { id: 'robo', label: 'Robô de atendimento', icone: 'smart_toy' },
    { id: 'agente', label: 'Agente de IA', icone: 'auto_awesome', bloqueado: !o.agenteLiberado },
  ]
  // Sem os Ajustes (gerente): só a Impressão, que ele já configurava antes.
  if (!o.podeAjustes) return o.podeImpressao ? todas.filter((t) => t.id === 'impressao') : []
  return o.podeImpressao ? todas : todas.filter((t) => t.id !== 'impressao')
}
