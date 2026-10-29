/**
 * Separa o texto de um alerta (lib/saude/avaliar.ts e lib/custo/alerta-whatsapp.ts) em partes para a tela:
 * 1ª linha "🔴 Menuzia — <título>", depois o que aconteceu, "Quanto: …" e "O que fazer: …". Pura.
 */
export interface PartesAlerta { titulo: string; oQue: string; quanto: string | null; fazer: string | null }

export function lerTextoAlerta(texto: string): PartesAlerta {
  const [primeira = '', ...resto] = texto.split('\n')
  const titulo = primeira.replace(/^\S+\s+Menuzia\s+—\s+/u, '').trim()
  let quanto: string | null = null
  let fazer: string | null = null
  const oQue: string[] = []
  for (const l of resto) {
    if (l.startsWith('Quanto:')) quanto = l.slice('Quanto:'.length).trim()
    else if (l.startsWith('O que fazer:')) fazer = l.slice('O que fazer:'.length).trim()
    else if (l.trim()) oQue.push(l.trim())
  }
  return { titulo, oQue: oQue.join(' '), quanto, fazer }
}
