/**
 * Login do motoboy por NOME (item 61): "João da Silva", "joão  da silva" e "JOAO DA SILVA" são o
 * mesmo nome. Também gera o usuário técnico do login a partir do nome ("joao.da.silva").
 */
export function nomeComparavel(nome: string): string {
  return nome.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

export function usuarioDoNome(nome: string): string {
  return nomeComparavel(nome).replace(/ /g, '.').slice(0, 30) || 'motoboy'
}

/**
 * Senha gerada para o motoboy (10/10): fácil de ditar e digitar no celular — 4 letras + 4 números, sem as letras que
 * confundem (l, o, i). Aparece UMA vez para a loja (copiar / enviar pelo WhatsApp) e nunca mais: só é redefinida.
 */
export function gerarSenhaMotoboy(aleatorio: (n: number) => number = (n) => crypto.getRandomValues(new Uint32Array(1))[0] % n): string {
  const letras = 'abcdefghjkmnpqrstuvwxyz'
  let s = ''
  for (let i = 0; i < 4; i++) s += letras[aleatorio(letras.length)]
  for (let i = 0; i < 4; i++) s += String(aleatorio(10))
  return s
}

/** Mensagem pronta do "Enviar pelo WhatsApp" (login, senha e link). */
export function mensagemAcessoMotoboy(p: { nome: string; loja: string; usuario: string; senha: string; url: string }): string {
  return `Olá, ${p.nome}! Seu acesso de entregador da ${p.loja}:\nLogin: ${p.usuario}\nSenha: ${p.senha}\nEntre em: ${p.url}\nDepois de entrar, toque em "Instalar app" para deixar o atalho no celular.`
}
