import { NextResponse } from 'next/server'
import { contextoImpressao, semCache } from '@/lib/impressao/contexto'
import { gerarConvite } from '@/lib/impressao/servico'
import { DOWNLOAD_ASSISTENTE_BETA, instaladorConectado, nomeInstalador } from '@/lib/impressao/rotulos'

/**
 * Instalador "já conectado" (noite 5): o MESMO instalador do Assistente Beta, entregue com um
 * convite de 24 h (uso único) no NOME do arquivo. Ao abrir pela primeira vez, o Assistente
 * (0.2.0-beta.10+) acha o arquivo em Downloads e se conecta à loja sem código.
 * POST (formulário do painel): gera o convite a cada download. Só quando o link oficial já é
 * de uma versão que lê o convite — antes disso, 409 e a tela nem mostra o botão.
 */
export async function POST() {
  const ctx = await contextoImpressao()
  if ('erro' in ctx) return ctx.erro
  if (!instaladorConectado()) {
    return NextResponse.json({ error: 'O instalador já conectado chega com o Assistente 0.2.0-beta.10.', codigo: 'versao_sem_convite' }, { status: 409, headers: semCache })
  }
  const r = await gerarConvite(ctx.admin, ctx.op, 'instalador')
  if (!r.ok) return NextResponse.json({ error: r.erro, codigo: r.codigo }, { status: r.status, headers: semCache })
  const origem = await fetch(DOWNLOAD_ASSISTENTE_BETA.url, { redirect: 'follow' })
  if (!origem.ok || !origem.body) return NextResponse.json({ error: 'Não foi possível baixar o instalador agora. Tente de novo.' }, { status: 502, headers: semCache })
  const nome = nomeInstalador(DOWNLOAD_ASSISTENTE_BETA.versao, r.valor.convite)
  return new NextResponse(origem.body, {
    status: 200,
    headers: {
      ...semCache,
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': `attachment; filename="${nome}"`,
      ...(origem.headers.get('content-length') ? { 'Content-Length': origem.headers.get('content-length')! } : {}),
    },
  })
}
