/**
 * "Links para divulgar" (Ajustes › Perfil da loja, 10/10/2026 — só com "Novidades em teste"). O endereço normal do
 * cardápio + etiqueta (utm), legível e sem encurtador externo. A vitrine lê a etiqueta (lib/origem-visita.ts) e o
 * pedido sai com a origem certa.
 */
export interface LinkDivulgar { id: string; canal: 'google' | 'instagram' | 'whatsapp' | 'qrcode'; rotulo: string; dica: string; url: string }

export function linksParaDivulgar(baseCardapio: string): LinkDivulgar[] {
  const base = baseCardapio.replace(/\/$/, '')
  const u = (q: Record<string, string>) => `${base}?${new URLSearchParams(q).toString()}`
  return [
    { id: 'google-site', canal: 'google', rotulo: 'Google — Site', dica: 'No Perfil da Empresa: campo "Site".', url: u({ utm_source: 'google', utm_medium: 'perfil', utm_content: 'site' }) },
    { id: 'google-cardapio', canal: 'google', rotulo: 'Google — Cardápio', dica: 'No Perfil da Empresa: "Links do cardápio".', url: u({ utm_source: 'google', utm_medium: 'perfil', utm_content: 'cardapio' }) },
    { id: 'google-pedido', canal: 'google', rotulo: 'Google — Link de pedido', dica: 'No Perfil da Empresa: "Links de pedido".', url: u({ utm_source: 'google', utm_medium: 'perfil', utm_content: 'pedido' }) },
    { id: 'instagram-bio', canal: 'instagram', rotulo: 'Instagram — Bio', dica: 'Editar perfil › Links.', url: u({ utm_source: 'instagram', utm_medium: 'bio' }) },
    { id: 'instagram-stories', canal: 'instagram', rotulo: 'Instagram — Stories', dica: 'Figurinha "Link" no story.', url: u({ utm_source: 'instagram', utm_medium: 'stories' }) },
    { id: 'whatsapp-status', canal: 'whatsapp', rotulo: 'WhatsApp — Status', dica: 'Cole no status do WhatsApp.', url: u({ utm_source: 'whatsapp', utm_medium: 'status' }) },
    { id: 'whatsapp-mensagem', canal: 'whatsapp', rotulo: 'WhatsApp — Mensagens', dica: 'Para mandar em conversas e grupos.', url: u({ utm_source: 'whatsapp', utm_medium: 'mensagem' }) },
    { id: 'qrcode-panfleto', canal: 'qrcode', rotulo: 'Panfleto / QR', dica: 'Imprima o QR no panfleto, cardápio de papel ou embalagem.', url: u({ utm_source: 'qrcode', utm_medium: 'panfleto' }) },
  ]
}

export const PASSOS_GOOGLE = [
  'Abra o Google Maps ou a busca do Google e procure o nome da sua loja (logado na conta que administra o Perfil da Empresa).',
  'Toque em "Editar perfil" › "Contato".',
  'Cole o link "Site" no campo Site, o "Cardápio" em Links do cardápio e o "Link de pedido" em Links de pedido.',
  'Salve. O Google pode levar alguns dias para mostrar os links novos.',
]
