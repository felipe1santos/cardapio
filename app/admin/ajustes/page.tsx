'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import QRCode from 'qrcode'
import { Copy, Check, QrCode } from 'lucide-react'
import { normalizarBairro, type FreteForaDaLista } from '@/lib/frete'
import { TopBar } from '@/components/layout/topbar'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { InstalarAppButton } from '@/components/instalar-app-button'
import { Field, Input, ToggleRow } from '@/components/admin/campos-ajustes'
import { TabQrCode } from '@/components/admin/ajustes-qrcode'
import { SubmenuVertical } from '@/components/admin/submenu-vertical'
import { getBrowserSupabase } from '@/lib/supabase/client'
import { buscarRestauranteIdDoUsuario, listarGrupos, type LayoutCardapio } from '@/lib/queries/cardapio'
import { AjustarFoco } from '@/components/ajustar-foco'
import { FOCO_PADRAO, objectPosition, type Foco } from '@/lib/foco-imagem'
import { BANNER_PROMO_MAX_IMAGENS, BANNER_PROMO_MAX_TEXTO, bannerPromocional } from '@/lib/banner-promocional'
import {
  buscarConfigLoja,
  atualizarConfigLoja,
  enviarLogoLoja,
  enviarBannerLoja,
  enviarBannerPromocionalLoja,
  listarTaxasBairro,
  criarTaxaBairro,
  atualizarTaxaBairro,
  removerTaxaBairro,
  listarTaxasRaio,
  criarTaxaRaio,
  atualizarTaxaRaio,
  removerTaxaRaio,
  salvarCoordenadasLoja,
  type TaxaRaio,
  type ConfigLoja,
  type TaxaBairro,
} from '@/lib/queries/ajustes'
import { geocodeEndereco } from '@/lib/frete'
import { turnosDoDia } from '@/lib/timezone'
import { StorePinMap } from '@/components/maps/store-pin-map'
import { composeEndereco } from '@/lib/endereco'
import { PALETAS, temaCores } from '@/lib/paletas'
import { listarEstacoes, criarEstacao, atualizarEstacao, rotacionarTokenEstacao, removerEstacao, type Estacao } from '@/lib/queries/estacoes'
import { MODOS, LABEL_MODO, type ModoEstacao } from '@/lib/cozinha/modo'
import { listarMesas, criarMesa, atualizarMesa, removerMesa, type Mesa } from '@/lib/queries/mesas'
import { CardModuloMesas } from '@/components/admin/modulo-mesas'
import { CardapioDaMesaConfig } from '@/app/admin/mesas/cardapio-mesa'
import { ConfigConta } from '@/app/admin/mesas/config-conta'

type Tab = 'loja' | 'entrega' | 'mesas' | 'qrcode' | 'conta' | 'aparencia' | 'cozinha'

const TABS: { id: Tab; label: string }[] = [
  { id: 'loja', label: 'Perfil da loja' },
  { id: 'entrega', label: 'Entrega' },
  { id: 'mesas', label: 'Mesas' },
  { id: 'qrcode', label: 'QR Code' },
  { id: 'aparencia', label: 'Aparência' },
  { id: 'cozinha', label: 'Cozinha' },
  { id: 'conta', label: 'Conta' },
]

/** Bloco de seção do painel de ajustes — agrupa campos afins sob um título. */
function Secao({
  titulo,
  descricao,
  className = '',
  children,
}: {
  titulo: string
  descricao?: string
  className?: string
  children: React.ReactNode
}) {
  return (
    <Card className={['space-y-4.5', className].join(' ')}>
      <div className="border-b border-border pb-3">
        <h3 className="text-[13px] font-bold text-text-main">{titulo}</h3>
        {descricao && <p className="mt-0.5 text-[11px] leading-relaxed text-text-subtle">{descricao}</p>}
      </div>
      {children}
    </Card>
  )
}

/** Rótulo de campo dentro de uma grade de endereço. */
function CampoLabel({ children }: { children: React.ReactNode }) {
  return <label className="mb-1 block text-[11px] font-medium text-text-subtle">{children}</label>
}


/** Feedback central de salvamento: spinner enquanto grava, check verde ao concluir. */
function SaveOverlay({ estado }: { estado: 'saving' | 'ok' }) {
  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-[#111827]/35">
      <div className="flex min-w-[210px] flex-col items-center gap-3 rounded-menuzia border border-border bg-white px-9 py-7 shadow-2xl">
        {estado === 'saving' ? (
          <>
            <svg viewBox="0 0 50 50" className="h-11 w-11 animate-spin text-primary">
              <circle cx="25" cy="25" r="20" fill="none" stroke="currentColor" strokeWidth="5" strokeOpacity="0.18" />
              <path d="M25 5a20 20 0 0 1 20 20" fill="none" stroke="currentColor" strokeWidth="5" strokeLinecap="round" />
            </svg>
            <span className="text-[13px] font-semibold text-text-main">Salvando…</span>
          </>
        ) : (
          <>
            <span className="flex h-11 w-11 items-center justify-center rounded-full bg-status-ready">
              <svg viewBox="0 0 24 24" className="h-6 w-6 fill-white">
                <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" />
              </svg>
            </span>
            <span className="text-[13px] font-semibold text-status-ready">Salvo!</span>
          </>
        )}
      </div>
    </div>
  )
}

function SaveBar({ saved, saving, onSave }: { saved: boolean; saving: boolean; onSave: () => void }) {
  const [overlay, setOverlay] = useState<'idle' | 'saving' | 'ok'>('idle')
  const estavaSalvando = useRef(false)

  // O check só aparece na transição de "salvando" para "salvo" — assim o overlay não
  // reabre sozinho quando o componente re-renderiza com `saved` ainda true.
  useEffect(() => {
    if (saving) {
      estavaSalvando.current = true
      setOverlay('saving')
      return
    }
    if (!estavaSalvando.current) return
    estavaSalvando.current = false
    if (!saved) {
      setOverlay('idle') // falhou: fecha e deixa a mensagem de erro da aba aparecer
      return
    }
    setOverlay('ok')
    const timer = setTimeout(() => setOverlay('idle'), 1400)
    return () => clearTimeout(timer)
  }, [saving, saved])

  return (
    <>
      <div className="flex items-center justify-between border-t border-border bg-main px-5 py-3">
        {saved && !saving
          ? <span className="text-[13px] font-medium text-status-ready">Alterações salvas.</span>
          : <span />}
        <Button onClick={onSave} disabled={saving}>
          {saving ? 'Salvando…' : 'Salvar alterações'}
        </Button>
      </div>
      {overlay !== 'idle' && <SaveOverlay estado={overlay} />}
    </>
  )
}

// ─── Aba Loja ─────────────────────────────────────────────────────────────────

const DIAS_SEMANA_LABEL = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado']

type TurnoForm = { abre: string; fecha: string }
type HorarioSemanaForm = Record<string, TurnoForm[]>

const TURNO_PADRAO: TurnoForm = { abre: '08:00', fecha: '22:00' }

function horarioSemanaPadrao(): HorarioSemanaForm {
  const dias: HorarioSemanaForm = {}
  for (let i = 0; i < 7; i++) dias[String(i)] = []
  return dias
}

function horarioSemanaFromConfig(horario: ConfigLoja['horarioFuncionamento']): HorarioSemanaForm {
  const dias = horarioSemanaPadrao()
  if (!horario) return dias
  for (let i = 0; i < 7; i++) dias[String(i)] = turnosDoDia(horario, i).map((t) => ({ ...t }))
  return dias
}

/** true se dois turnos do mesmo dia se sobrepõem. Turno que vira o dia é normalizado
 *  para minutos corridos a partir da abertura, senão 18:00–02:00 nunca colidiria. */
function turnosSobrepostos(turnos: TurnoForm[]): boolean {
  const min = (h: string) => Number(h.slice(0, 2)) * 60 + Number(h.slice(3, 5))
  const faixas = turnos.map((t) => {
    const inicio = min(t.abre)
    const fim = min(t.fecha)
    return { inicio, fim: fim > inicio ? fim : fim + 24 * 60 }
  })
  for (let a = 0; a < faixas.length; a++) {
    for (let b = a + 1; b < faixas.length; b++) {
      if (faixas[a].inicio < faixas[b].fim && faixas[b].inicio < faixas[a].fim) return true
    }
  }
  return false
}

function TabLoja({ restauranteId, active }: { restauranteId: string; active: boolean }) {
  const supabase = useMemo(() => getBrowserSupabase(), [])
  const [loaded, setLoaded] = useState(false)
  const [config, setConfig] = useState<ConfigLoja | null>(null)
  const [form, setForm] = useState({
    nome: '',
    telefone: '',
    enderecoRua: '',
    enderecoNumero: '',
    enderecoComplemento: '',
    enderecoBairro: '',
    enderecoCidade: '',
    enderecoEstado: '',
    cep: '',
    latitude: null as number | null,
    longitude: null as number | null,
    avaliacaoNota: '',
    avaliacaoQtd: '',
    logoUrl: '',
    bannerUrl: '',
    bannerMobileUrl: '',
    bannerPromocionalUrl: '',
    bannerPromoUrls: [] as string[],
    bannerPromoTexto: '',
    layoutCardapio: 'categoria' as LayoutCardapio,
    imagemGrande: false,
    bannerFoco: FOCO_PADRAO as Foco,
    bannerPromoFoco: FOCO_PADRAO as Foco,
  })
  const [horarioDias, setHorarioDias] = useState<HorarioSemanaForm>(horarioSemanaPadrao())
  const [categoriasSemFoto, setCategoriasSemFoto] = useState<string[]>([])
  // Três estados, não dois: "ainda não conferiu" (carregadas=false), "conferiu"
  // (carregadas=true) e "tentou conferir e falhou" (erroCategorias=true). Sem o
  // primeiro, o botão da Gaveta ficaria destravado por um instante entre a
  // config carregar e as categorias chegarem; sem o terceiro, uma falha na
  // leitura DESTRAVARIA o botão — e a falha mais provável é justamente a coluna
  // imagem_url ainda não existir, que é o estado em que o cadeado mais importa
  // (spec: nunca destravar sem checar).
  const [categoriasCarregadas, setCategoriasCarregadas] = useState(false)
  const [erroCategorias, setErroCategorias] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [uploadingLogo, setUploadingLogo] = useState(false)
  const logoInputRef = useRef<HTMLInputElement>(null)
  const [uploadingBanner, setUploadingBanner] = useState(false)
  const bannerInputRef = useRef<HTMLInputElement>(null)
  const [uploadingBannerPromo, setUploadingBannerPromo] = useState(false)
  const bannerPromoInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (loaded) return
    buscarConfigLoja(supabase, restauranteId).then((c) => {
      if (!c) return
      setConfig(c)
      setForm({
        nome: c.nome,
        telefone: c.telefone,
        enderecoRua: c.enderecoRua,
        enderecoNumero: c.enderecoNumero,
        enderecoComplemento: c.enderecoComplemento,
        enderecoBairro: c.enderecoBairro,
        enderecoCidade: c.enderecoCidade,
        enderecoEstado: c.enderecoEstado,
        cep: c.cep,
        latitude: c.latitude,
        longitude: c.longitude,
        avaliacaoNota: c.avaliacaoNota === null ? '' : String(c.avaliacaoNota),
        avaliacaoQtd: c.avaliacaoQtd === null ? '' : String(c.avaliacaoQtd),
        logoUrl: c.logoUrl ?? '',
        bannerUrl: c.bannerUrl ?? '',
        bannerMobileUrl: c.bannerMobileUrl ?? '',
        bannerPromocionalUrl: c.bannerPromocionalUrl ?? '',
        bannerPromoUrls: c.bannerPromoUrls ?? [],
        bannerPromoTexto: c.bannerPromoTexto ?? '',
        layoutCardapio: c.layoutCardapio,
        imagemGrande: c.imagemGrande,
        bannerFoco: c.bannerFoco,
        bannerPromoFoco: c.bannerPromoFoco,
      })
      setHorarioDias(horarioSemanaFromConfig(c.horarioFuncionamento))
      setLoaded(true)
    })
    listarGrupos(supabase, restauranteId)
      .then((gs) => {
        setCategoriasSemFoto(gs.filter((g) => !g.imagemUrl).map((g) => g.nome))
        setCategoriasCarregadas(true)
      })
      .catch(() => setErroCategorias(true))
  }, [supabase, restauranteId, loaded])

  function set(
    key:
      | 'nome' | 'telefone' | 'cep'
      | 'enderecoRua' | 'enderecoNumero' | 'enderecoComplemento' | 'enderecoBairro' | 'enderecoCidade' | 'enderecoEstado'
      | 'avaliacaoNota' | 'avaliacaoQtd'
      | 'logoUrl' | 'bannerUrl' | 'bannerMobileUrl' | 'bannerPromocionalUrl',
    value: string
  ) {
    setForm((f) => ({ ...f, [key]: value }))
    setSaved(false)
  }

  function setPin(lat: number, lng: number) {
    setForm((f) => ({ ...f, latitude: lat, longitude: lng }))
    setSaved(false)
  }

  async function handleLogoPick(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    setUploadingLogo(true)
    setError(null)
    try {
      const url = await enviarLogoLoja(supabase, restauranteId, file)
      set('logoUrl', url)
    } catch {
      setError('Não foi possível enviar a imagem. Verifique se o bucket "cardapio" existe no Supabase Storage.')
    } finally {
      setUploadingLogo(false)
    }
  }

  async function handleBannerPick(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    setUploadingBanner(true)
    setError(null)
    try {
      // Sobe a capa nas duas larguras; a estreita pode vir null e a vitrine
      // simplesmente não emite o srcset.
      const { url, mobileUrl } = await enviarBannerLoja(supabase, restauranteId, file)
      // Imagem nova, enquadramento novo: manter o foco da capa antiga faria a
      // vitrine recortar a arte nova num ponto que ninguém escolheu pra ela.
      setForm((prev) => ({ ...prev, bannerUrl: url, bannerMobileUrl: mobileUrl ?? '', bannerFoco: FOCO_PADRAO }))
      setSaved(false)
    } catch {
      setError('Não foi possível enviar a imagem. Verifique se o bucket "cardapio" existe no Supabase Storage.')
    } finally {
      setUploadingBanner(false)
    }
  }

  /**
   * Envia uma ou mais imagens para o banner promocional. Várias de uma vez
   * porque o lojista escolhe as promoções da semana juntas, não uma por vez.
   *
   * A imagem vai para `bannerPromoUrls`; `bannerPromocionalUrl` (a coluna antiga)
   * só é limpa quando ela já estiver na lista, para a loja não ficar com a mesma
   * arte duas vezes. Ver lib/banner-promocional.ts.
   */
  async function handleBannerPromoPick(event: React.ChangeEvent<HTMLInputElement>) {
    const files = [...(event.target.files ?? [])]
    event.target.value = ''
    if (files.length === 0) return
    const espaco = BANNER_PROMO_MAX_IMAGENS - form.bannerPromoUrls.length
    if (espaco <= 0) {
      setError(`O banner promocional aceita até ${BANNER_PROMO_MAX_IMAGENS} imagens. Remova uma antes de enviar outra.`)
      return
    }
    setUploadingBannerPromo(true)
    setError(null)
    try {
      const novas: string[] = []
      for (const file of files.slice(0, espaco)) {
        novas.push(await enviarBannerPromocionalLoja(supabase, restauranteId, file))
      }
      setForm((prev) => ({
        ...prev,
        bannerPromoUrls: [...prev.bannerPromoUrls, ...novas],
        bannerPromoFoco: prev.bannerPromoUrls.length === 0 ? FOCO_PADRAO : prev.bannerPromoFoco,
      }))
      setSaved(false)
    } catch {
      setError('Não foi possível enviar a imagem. Verifique se o bucket "cardapio" existe no Supabase Storage.')
    } finally {
      setUploadingBannerPromo(false)
    }
  }

  /**
   * A lista que a tela mostra: as imagens novas mais a arte do cadastro antigo,
   * resolvidas pela mesma regra da vitrine — assim a prévia do painel e o
   * cardápio nunca discordam sobre o que está no ar.
   */
  const imagensPromo = (() => {
    const b = bannerPromocional({ urls: form.bannerPromoUrls, urlLegado: form.bannerPromocionalUrl })
    return b.tipo === 'imagens' ? b.urls : []
  })()

  function removerImagemPromo(url: string) {
    setForm((prev) => ({
      ...prev,
      bannerPromoUrls: prev.bannerPromoUrls.filter((u) => u !== url),
      // A arte antiga vive na outra coluna: removê-la da tela precisa limpar lá.
      bannerPromocionalUrl: prev.bannerPromocionalUrl === url ? '' : prev.bannerPromocionalUrl,
    }))
    setSaved(false)
  }

  function moverImagemPromo(url: string, direcao: -1 | 1) {
    setForm((prev) => {
      const lista = [...prev.bannerPromoUrls]
      const i = lista.indexOf(url)
      const j = i + direcao
      if (i === -1 || j < 0 || j >= lista.length) return prev
      ;[lista[i], lista[j]] = [lista[j]!, lista[i]!]
      return { ...prev, bannerPromoUrls: lista }
    })
    setSaved(false)
  }

  function setLayout(value: LayoutCardapio) {
    setForm((f) => ({ ...f, layoutCardapio: value }))
    setSaved(false)
  }

  function setTurnos(dia: string, turnos: TurnoForm[]) {
    setHorarioDias((prev) => ({ ...prev, [dia]: turnos }))
    setSaved(false)
  }

  /** Marcar o dia cria o primeiro turno; desmarcar apaga todos (dia fechado). */
  function toggleDia(dia: string, ativo: boolean) {
    setTurnos(dia, ativo ? [{ ...TURNO_PADRAO }] : [])
  }

  function addTurno(dia: string) {
    setTurnos(dia, [...horarioDias[dia], { ...TURNO_PADRAO }])
  }

  /** Remover o último turno equivale a fechar o dia. */
  function removeTurno(dia: string, index: number) {
    setTurnos(dia, horarioDias[dia].filter((_, i) => i !== index))
  }

  function setTurno(dia: string, index: number, patch: Partial<TurnoForm>) {
    setTurnos(dia, horarioDias[dia].map((t, i) => (i === index ? { ...t, ...patch } : t)))
  }

  const diasComSobreposicao = Object.entries(horarioDias)
    .filter(([, turnos]) => turnosSobrepostos(turnos))
    .map(([dia]) => Number(dia))

  /** Endereço montado a partir do formulário — alimenta o mapa e o resumo abaixo dele. */
  const enderecoResumo = composeEndereco({
    rua: form.enderecoRua,
    numero: form.enderecoNumero,
    complemento: form.enderecoComplemento,
    bairro: form.enderecoBairro,
    cidade: form.enderecoCidade,
    estado: form.enderecoEstado,
  })

  async function save() {
    if (!form.nome.trim()) { setError('O nome do estabelecimento é obrigatório.'); return }
    if (diasComSobreposicao.length > 0) {
      setError(`Turnos sobrepostos em: ${diasComSobreposicao.map((d) => DIAS_SEMANA_LABEL[d]).join(', ')}.`)
      return
    }
    setSaving(true)
    setError(null)
    try {
      const horarioFuncionamento: NonNullable<ConfigLoja['horarioFuncionamento']> = {}
      for (const [dia, turnos] of Object.entries(horarioDias)) {
        horarioFuncionamento[dia] = turnos.length > 0 ? turnos.map((t) => ({ ...t })) : null
      }
      const updated = await atualizarConfigLoja(supabase, restauranteId, {
        nome: form.nome.trim(),
        telefone: form.telefone.trim(),
        enderecoRua: form.enderecoRua.trim(),
        enderecoNumero: form.enderecoNumero.trim(),
        enderecoComplemento: form.enderecoComplemento.trim(),
        enderecoBairro: form.enderecoBairro.trim(),
        enderecoCidade: form.enderecoCidade.trim(),
        enderecoEstado: form.enderecoEstado.trim(),
        cep: form.cep.trim(),
        latitude: form.latitude,
        longitude: form.longitude,
        avaliacaoNota: form.avaliacaoNota.trim() === '' ? null : Number(form.avaliacaoNota.replace(',', '.')),
        avaliacaoQtd: form.avaliacaoQtd.trim() === '' ? null : Math.round(Number(form.avaliacaoQtd)),
        logoUrl: form.logoUrl.trim() || null,
        bannerUrl: form.bannerUrl.trim() || null,
        bannerMobileUrl: form.bannerMobileUrl.trim() || null,
        bannerPromocionalUrl: form.bannerPromocionalUrl.trim() || null,
        bannerPromoUrls: form.bannerPromoUrls,
        bannerPromoTexto: form.bannerPromoTexto.trim() || null,
        layoutCardapio: form.layoutCardapio,
        imagemGrande: form.imagemGrande,
        bannerFoco: form.bannerFoco,
        bannerPromoFoco: form.bannerPromoFoco,
        horarioFuncionamento,
      })
      setConfig(updated)
      setForm((f) => ({ ...f, latitude: updated.latitude, longitude: updated.longitude }))
      setHorarioDias(horarioSemanaFromConfig(updated.horarioFuncionamento))
      setSaved(true)
    } catch {
      setError('Não foi possível salvar as alterações. Verifique sua conexão e tente novamente.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className={['flex flex-1 flex-col overflow-hidden', !active ? 'hidden' : ''].join(' ')}>
      <div className="flex-1 overflow-y-auto px-5 py-6">
        <div className="mx-auto grid max-w-5xl items-start gap-5 xl:grid-cols-2">

        <Secao titulo="Identidade da loja" descricao="Como o cliente reconhece você no cardápio e no painel.">
          <Field label="Nome do estabelecimento">
            <Input value={form.nome} onChange={(e) => set('nome', e.target.value)} placeholder="Ex: Burger House" />
          </Field>
          <Field label="Telefone / WhatsApp">
            <Input value={form.telefone} onChange={(e) => set('telefone', e.target.value)} placeholder="(00) 00000-0000" />
          </Field>
          <Field label="Logotipo" hint="Exibido como avatar da loja no painel e no cardápio do cliente. Deixe em branco para usar a inicial do nome.">
            <div className="flex items-center gap-3">
              {form.logoUrl
                // eslint-disable-next-line @next/next/no-img-element
                ? <img src={form.logoUrl} alt="Logotipo" className="h-16 w-16 rounded-menuzia border border-border object-cover" />
                : <div className="flex h-16 w-16 items-center justify-center rounded-menuzia border border-border bg-page text-xl font-bold text-text-subtle">
                    {form.nome.trim().charAt(0).toUpperCase() || '?'}
                  </div>
              }
              <input ref={logoInputRef} type="file" accept="image/*" className="hidden" onChange={handleLogoPick} />
              <div className="flex flex-col gap-1.5">
                <Button variant="outline" type="button" onClick={() => logoInputRef.current?.click()} disabled={uploadingLogo}>
                  {uploadingLogo ? 'Enviando…' : form.logoUrl ? 'Trocar imagem' : 'Enviar imagem'}
                </Button>
                {form.logoUrl && (
                  <button type="button" onClick={() => set('logoUrl', '')} className="text-[12px] text-text-subtle hover:text-danger">Remover</button>
                )}
              </div>
            </div>
          </Field>
          {config && (
            <Field label="Endereço público da loja" hint="Gerado automaticamente a partir do nome — não pode ser alterado por aqui.">
              <div className="flex items-center gap-2.5 rounded-menuzia border border-border bg-page px-3 py-2.5">
                {/* O domínio precisa ser o real — o lojista copia daqui pra
                    colar na bio do Instagram. "cardapio.app" era placeholder
                    e mandava o cliente pra um endereço que não existe. */}
                <span className="text-sm text-text-subtle">
                  {typeof window === 'undefined' ? '' : `${window.location.host}/loja/`}
                </span>
                <span className="text-sm font-semibold text-text-main">{config.slug}</span>
              </div>
            </Field>
          )}
        </Secao>

        <Secao titulo="Prova social" descricao="Reforça a confiança de quem chega no cardápio pela primeira vez.">
          <Field label="Avaliação" hint="Exibida na vitrine como prova social — preencha manualmente com base nas avaliações reais da loja (Google, iFood, etc.). Deixe em branco pra não mostrar nada.">
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <CampoLabel>Nota</CampoLabel>
                <Input
                  value={form.avaliacaoNota}
                  onChange={(e) => set('avaliacaoNota', e.target.value)}
                  placeholder="4.9"
                  inputMode="decimal"
                />
              </div>
              <div>
                <CampoLabel>Quantidade de avaliações</CampoLabel>
                <Input
                  value={form.avaliacaoQtd}
                  onChange={(e) => set('avaliacaoQtd', e.target.value)}
                  placeholder="912"
                  inputMode="numeric"
                />
              </div>
            </div>
          </Field>
        </Secao>

        <Secao
          titulo="Endereço da loja"
          descricao="Base do cálculo de frete, do mapa de calor do Dashboard e da localização mostrada ao cliente."
          className="xl:col-span-2"
        >
          <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
            <div className="space-y-3.5">
              <div className="grid gap-3 sm:grid-cols-[minmax(0,3fr)_minmax(0,1fr)]">
                <div>
                  <CampoLabel>Rua</CampoLabel>
                  <Input value={form.enderecoRua} onChange={(e) => set('enderecoRua', e.target.value)} placeholder="Rua das Flores" />
                </div>
                <div>
                  <CampoLabel>Número</CampoLabel>
                  <Input value={form.enderecoNumero} onChange={(e) => set('enderecoNumero', e.target.value)} placeholder="123" />
                </div>
              </div>
              <div>
                <CampoLabel>Complemento</CampoLabel>
                <Input value={form.enderecoComplemento} onChange={(e) => set('enderecoComplemento', e.target.value)} placeholder="Sala, bloco, referência (opcional)" />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <CampoLabel>Bairro</CampoLabel>
                  <Input value={form.enderecoBairro} onChange={(e) => set('enderecoBairro', e.target.value)} placeholder="Centro" />
                </div>
                <div>
                  <CampoLabel>Cidade</CampoLabel>
                  <Input value={form.enderecoCidade} onChange={(e) => set('enderecoCidade', e.target.value)} placeholder="Fortaleza" />
                </div>
              </div>
              <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
                <div>
                  <CampoLabel>UF</CampoLabel>
                  <Input value={form.enderecoEstado} onChange={(e) => set('enderecoEstado', e.target.value.toUpperCase().slice(0, 2))} placeholder="CE" maxLength={2} />
                </div>
                <div>
                  <CampoLabel>CEP</CampoLabel>
                  <Input value={form.cep} onChange={(e) => set('cep', e.target.value)} placeholder="00000-000" inputMode="numeric" autoComplete="postal-code" name="cep" />
                </div>
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <StorePinMap
                apiKey={process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY}
                address={enderecoResumo}
                lat={form.latitude}
                lng={form.longitude}
                onChange={setPin}
                className="h-[240px] w-full border border-border"
              />
              <p className="text-[11px] text-text-subtle">Arraste o pin pra ajustar a localização exata da loja no mapa.</p>

              {/* Confirmação do que foi preenchido, logo abaixo do mapa. */}
              <div className="rounded-menuzia bg-[#024A7D] px-3.5 py-3 text-white">
                <div className="text-[10px] font-semibold uppercase tracking-wide text-white/65">
                  Endereço cadastrado
                </div>
                {enderecoResumo ? (
                  <>
                    <p className="mt-1 text-[13px] font-semibold leading-snug">{enderecoResumo}</p>
                    {form.cep.trim() && (
                      <p className="mt-0.5 text-[12px] text-white/75">CEP {form.cep.trim()}</p>
                    )}
                  </>
                ) : (
                  <p className="mt-1 text-[12px] leading-snug text-white/75">
                    Preencha os campos ao lado para confirmar o endereço aqui.
                  </p>
                )}
              </div>
            </div>
          </div>
        </Secao>

        <Secao
          titulo="Horário de funcionamento"
          descricao="A loja abre e fecha sozinha nesses horários (fuso de São Paulo). Cada dia pode ter mais de um turno — ex.: almoço 11:00–14:00 e jantar 18:00–23:00, com a loja fechada no vão da tarde. Dia sem marcação = fechada. Você ainda pode forçar aberta/fechada a qualquer momento pelo Painel de Pedidos."
          className="xl:col-span-2"
        >
          <Field label="Turnos da semana">
            <div className="grid gap-2.5 sm:grid-cols-2">
              {DIAS_SEMANA_LABEL.map((label, i) => {
                const dia = String(i)
                const turnos = horarioDias[dia]
                const sobreposto = diasComSobreposicao.includes(i)
                return (
                  <div
                    key={dia}
                    className={[
                      'flex gap-2.5 rounded-menuzia border bg-white p-2.5',
                      turnos.length > 0 ? 'border-border' : 'border-border/60 bg-page/40',
                    ].join(' ')}
                  >
                    <label className="flex w-[110px] flex-shrink-0 cursor-pointer items-center gap-2 pt-1 text-[12px] font-medium text-text-main">
                      <input
                        type="checkbox"
                        checked={turnos.length > 0}
                        onChange={(e) => toggleDia(dia, e.target.checked)}
                        className="h-4 w-4 accent-primary"
                      />
                      {label}
                    </label>
                    {turnos.length === 0 ? (
                      <span className="pt-1 text-[12px] text-text-subtle">Fechada</span>
                    ) : (
                      <div className="min-w-0 flex-1 space-y-1.5">
                        {turnos.map((t, index) => (
                          <div key={index} className="flex flex-wrap items-center gap-1.5">
                            <input
                              type="time"
                              value={t.abre}
                              onChange={(e) => setTurno(dia, index, { abre: e.target.value })}
                              className="rounded-menuzia border border-border px-2 py-1 text-[12px] outline-none focus:border-primary"
                            />
                            <span className="text-[12px] text-text-subtle">até</span>
                            <input
                              type="time"
                              value={t.fecha}
                              onChange={(e) => setTurno(dia, index, { fecha: e.target.value })}
                              className="rounded-menuzia border border-border px-2 py-1 text-[12px] outline-none focus:border-primary"
                            />
                            {t.fecha <= t.abre && (
                              <span className="text-[11px] text-text-subtle">vira o dia seguinte</span>
                            )}
                            <button
                              type="button"
                              onClick={() => removeTurno(dia, index)}
                              title="Remover turno"
                              className="ml-auto flex h-[26px] w-[26px] items-center justify-center rounded-menuzia border border-border text-text-subtle hover:border-danger hover:text-danger"
                            >
                              ✕
                            </button>
                          </div>
                        ))}
                        <button
                          type="button"
                          onClick={() => addTurno(dia)}
                          className="text-[11px] font-semibold uppercase tracking-wide text-primary hover:text-primary-dark"
                        >
                          + adicionar turno
                        </button>
                        {sobreposto && (
                          <p className="text-[11px] font-medium text-danger">Os turnos deste dia se sobrepõem.</p>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </Field>
        </Secao>

        <Secao titulo="Imagens do cardápio" descricao="Capa e destaque promocional exibidos na vitrine pública.">
          <Field label="Banner de capa" hint="Imagem de capa exibida no topo do cardápio do cliente. Deixe em branco para usar o degradê padrão.">
            <div className="space-y-2.5">
              {form.bannerUrl && (
                // A miniatura mostra o recorte REAL da vitrine no celular
                // (2:1 + o ponto de foco escolhido), pra que o lojista veja
                // aqui mesmo o efeito de "Ajustar posição" sem abrir a loja.
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={form.bannerUrl}
                  alt="Banner de capa"
                  className="aspect-[2/1] w-full rounded-menuzia border border-border object-cover"
                  style={{ objectPosition: objectPosition(form.bannerFoco) }}
                />
              )}
              <input ref={bannerInputRef} type="file" accept="image/*" className="hidden" onChange={handleBannerPick} />
              <div className="flex flex-wrap items-center gap-3">
                <Button variant="outline" type="button" onClick={() => bannerInputRef.current?.click()} disabled={uploadingBanner}>
                  {uploadingBanner ? 'Enviando…' : form.bannerUrl ? 'Trocar imagem' : 'Enviar imagem'}
                </Button>
                {form.bannerUrl && (
                  <AjustarFoco
                    src={form.bannerUrl}
                    foco={form.bannerFoco}
                    onChange={(f) => { setForm((prev) => ({ ...prev, bannerFoco: f })); setSaved(false) }}
                    // Medido na vitrine em produção: 2:1 no celular (aspect
                    // fixo) e 1214×280 no desktop. O 3,8 que estava aqui vinha
                    // de contar `lg:h-80` como 320 px — o html da vitrine tem
                    // base 14 px, então são 280 px e a proporção real é 4,33.
                    proporcoes={[{ rotulo: 'Celular', ratio: 2 }, { rotulo: 'Computador', ratio: 4.33 }]}
                    titulo="Posição do banner de capa"
                    descricao="A capa aparece em proporções diferentes no celular e no computador. Marque o que não pode ser cortado."
                    disabled={uploadingBanner}
                  />
                )}
                {form.bannerUrl && (
                  <button type="button" onClick={() => { setForm((prev) => ({ ...prev, bannerUrl: '', bannerMobileUrl: '', bannerFoco: FOCO_PADRAO })); setSaved(false) }} className="text-[12px] text-text-subtle hover:text-danger">Remover</button>
                )}
              </div>
            </div>
          </Field>
          <Field
            label="Banner promocional"
            hint="Aparece dentro do cardápio, logo abaixo das categorias. Suba uma ou mais imagens (com mais de uma, elas passam sozinhas) OU escreva um aviso. Deixe tudo em branco pra não mostrar nada."
          >
            <div className="space-y-3">
              {imagensPromo.length > 0 && (
                <div className="space-y-2">
                  {imagensPromo.map((url, i) => (
                    <div key={url} className="flex items-center gap-2">
                      {/* Miniatura na proporção da faixa do celular, com o foco
                          escolhido — é assim que o cliente vai ver. */}
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={url}
                        alt={`Banner promocional ${i + 1}`}
                        className="aspect-[2.58/1] w-full min-w-0 flex-1 rounded-menuzia border border-border object-cover"
                        style={{ objectPosition: objectPosition(form.bannerPromoFoco) }}
                      />
                      <div className="flex flex-shrink-0 flex-col gap-1">
                        <button
                          type="button"
                          onClick={() => moverImagemPromo(url, -1)}
                          disabled={i === 0}
                          aria-label="Mover para antes"
                          className="grid h-8 w-8 place-items-center rounded-menuzia border border-border text-text-subtle hover:border-primary hover:text-primary disabled:opacity-30"
                        >
                          ↑
                        </button>
                        <button
                          type="button"
                          onClick={() => moverImagemPromo(url, 1)}
                          disabled={i === imagensPromo.length - 1}
                          aria-label="Mover para depois"
                          className="grid h-8 w-8 place-items-center rounded-menuzia border border-border text-text-subtle hover:border-primary hover:text-primary disabled:opacity-30"
                        >
                          ↓
                        </button>
                        <button
                          type="button"
                          onClick={() => removerImagemPromo(url)}
                          aria-label="Remover imagem"
                          className="grid h-8 w-8 place-items-center rounded-menuzia border border-border text-danger hover:bg-danger-bg"
                        >
                          ×
                        </button>
                      </div>
                    </div>
                  ))}
                  {imagensPromo.length > 1 && (
                    <p className="text-[11px] text-text-subtle">
                      {imagensPromo.length} imagens — no cardápio elas passam sozinhas, a cada 5 segundos, nesta ordem.
                    </p>
                  )}
                </div>
              )}

              <input ref={bannerPromoInputRef} type="file" accept="image/*" multiple className="hidden" onChange={handleBannerPromoPick} />
              <div className="flex flex-wrap items-center gap-3">
                <Button variant="outline" type="button" onClick={() => bannerPromoInputRef.current?.click()} disabled={uploadingBannerPromo || imagensPromo.length >= BANNER_PROMO_MAX_IMAGENS}>
                  {uploadingBannerPromo ? 'Enviando…' : imagensPromo.length > 0 ? 'Adicionar imagem' : 'Enviar imagem'}
                </Button>
                {imagensPromo.length > 0 && (
                  <AjustarFoco
                    src={imagensPromo[0]!}
                    foco={form.bannerPromoFoco}
                    onChange={(f) => { setForm((prev) => ({ ...prev, bannerPromoFoco: f })); setSaved(false) }}
                    // A faixa tem 139 px no celular e 169 px no desktop (10% a
                    // mais que antes). Daí 358/139 = 2,58 no celular e
                    // 1224/169 = 7,24 no desktop — continua um talho largo, e é
                    // por isso que ela precisa de foco.
                    proporcoes={[{ rotulo: 'Celular', ratio: 2.58 }, { rotulo: 'Computador', ratio: 7.24 }]}
                    titulo="Posição do banner promocional"
                    descricao="A faixa é bem mais larga que alta e corta bastante da arte. Marque o que não pode sumir. Vale para todas as imagens."
                    disabled={uploadingBannerPromo}
                  />
                )}
                {imagensPromo.length >= BANNER_PROMO_MAX_IMAGENS && (
                  <span className="text-[11px] text-text-subtle">Limite de {BANNER_PROMO_MAX_IMAGENS} imagens.</span>
                )}
              </div>

              {/* Alternativa para quem não tem arte pronta. Só aparece no
                  cardápio quando não há imagem nenhuma — as duas coisas na
                  mesma faixa brigariam pelo mesmo espaço. */}
              <div className="border-t border-border pt-3">
                <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-text-subtle">
                  Ou um aviso em texto
                </div>
                <input
                  value={form.bannerPromoTexto}
                  onChange={(e) => { setForm((prev) => ({ ...prev, bannerPromoTexto: e.target.value.slice(0, BANNER_PROMO_MAX_TEXTO) })); setSaved(false) }}
                  placeholder="Ex.: Hoje a pizza grande sai por R$ 49 até 22h"
                  className="w-full rounded-menuzia border border-border px-2.5 py-2 font-sans text-[13px] text-text-main outline-none focus:border-primary"
                />
                <div className="mt-1 flex items-center justify-between gap-2">
                  <p className="text-[11px] text-text-subtle">
                    {imagensPromo.length > 0
                      ? 'Enquanto houver imagem, o aviso em texto não aparece no cardápio.'
                      : 'Aparece como uma faixa com a cor da sua loja.'}
                  </p>
                  <span className="flex-shrink-0 text-[11px] text-text-subtle">{form.bannerPromoTexto.length}/{BANNER_PROMO_MAX_TEXTO}</span>
                </div>
              </div>
            </div>
          </Field>
        </Secao>

        <Secao titulo="Apresentação do cardápio" descricao="Como os itens aparecem para o cliente na vitrine pública.">
          <Field label="Formato da lista">
            {/* Três colunas só quando cabem: a 375 px cada cartão fica com ~105 px
                e a legenda ("Cartão por categoria, com foto") quebra em cinco
                linhas de uma palavra. Empilhado, cada modo fica legível. */}
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
              <button
                type="button"
                onClick={() => setLayout('categoria')}
                className={[
                  'rounded-menuzia border px-3.5 py-3 text-left transition-colors',
                  form.layoutCardapio === 'categoria' ? 'border-primary bg-primary/10' : 'border-border bg-white hover:border-primary/50',
                ].join(' ')}
              >
                <div className="text-[13px] font-semibold text-text-main">Categorias</div>
                <div className="mt-0.5 text-[11px] text-text-subtle">Cards grandes, 2 por linha</div>
              </button>
              <button
                type="button"
                onClick={() => setLayout('lista')}
                className={[
                  'rounded-menuzia border px-3.5 py-3 text-left transition-colors',
                  form.layoutCardapio === 'lista' ? 'border-primary bg-primary/10' : 'border-border bg-white hover:border-primary/50',
                ].join(' ')}
              >
                <div className="text-[13px] font-semibold text-text-main">Lista</div>
                <div className="mt-0.5 text-[11px] text-text-subtle">Itens em lista compacta</div>
              </button>
              <button
                type="button"
                disabled={erroCategorias || !categoriasCarregadas || categoriasSemFoto.length > 0}
                onClick={() => setLayout('gaveta')}
                className={[
                  'rounded-menuzia border px-3.5 py-3 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50',
                  form.layoutCardapio === 'gaveta' ? 'border-primary bg-primary/10' : 'border-border bg-white hover:border-primary/50',
                ].join(' ')}
              >
                <div className="text-[13px] font-semibold text-text-main">Gaveta</div>
                <div className="mt-0.5 text-[11px] text-text-subtle">Cartão por categoria, com foto</div>
              </button>
            </div>
            {erroCategorias && (
              <p className="mt-2 rounded-menuzia bg-danger-bg px-3 py-2 text-[12px] leading-relaxed text-danger">
                Não conseguimos verificar as fotos das categorias. Recarregue a página.
              </p>
            )}
            {!erroCategorias && categoriasSemFoto.length > 0 && (
              <p className="mt-2 rounded-menuzia bg-alert-bg px-3 py-2 text-[12px] leading-relaxed text-alert-text">
                O modo Gaveta precisa de uma foto em cada categoria.{' '}
                {categoriasSemFoto.length === 1 ? 'Falta' : 'Faltam'} {categoriasSemFoto.length}:{' '}
                {categoriasSemFoto.join(' · ')}.{' '}
                <a href="/admin/cardapio" className="font-semibold underline">Subir fotos no cardápio</a>.
              </p>
            )}
          </Field>
          <Field label="Imagem grande" hint="Na visualização em lista, mostra as imagens dos itens em 100×100 px.">
            <label className="flex cursor-pointer items-center gap-2.5 rounded-menuzia border border-border bg-white px-3.5 py-3">
              <input
                type="checkbox"
                checked={form.imagemGrande}
                onChange={(e) => setForm((f) => ({ ...f, imagemGrande: e.target.checked }))}
                className="h-4 w-4 accent-primary"
              />
              <span className="text-[13px] font-medium text-text-main">Usar imagens grandes (100×100) na lista do cardápio</span>
            </label>
          </Field>
        </Secao>

        {error && (
          <p className="rounded-menuzia border border-danger bg-danger/10 px-3 py-2 text-[13px] text-danger xl:col-span-2">
            {error}
          </p>
        )}
        </div>
      </div>
      <SaveBar saved={saved} saving={saving} onSave={save} />
    </div>
  )
}

// ─── Aba Entrega ──────────────────────────────────────────────────────────────

function TabEntrega({ restauranteId, active }: { restauranteId: string; active: boolean }) {
  const supabase = useMemo(() => getBrowserSupabase(), [])
  const [loaded, setLoaded] = useState(false)
  const [taxaPadrao, setTaxaPadrao] = useState('')
  const [taxaPadraoSalva, setTaxaPadraoSalva] = useState(0)
  const [freteGratis, setFreteGratis] = useState('')
  const [freteGratisSalvo, setFreteGratisSalvo] = useState<number | null>(null)
  const [savingFreteGratis, setSavingFreteGratis] = useState(false)
  const [savedFreteGratis, setSavedFreteGratis] = useState(false)
  const [bairros, setBairros] = useState<TaxaBairro[]>([])
  // Bairro sem taxa cadastrada: bloquear (lista fechada) ou aceitar pela taxa padrão.
  // Começa no modo seguro até a config carregar.
  const [foraDaLista, setForaDaLista] = useState<FreteForaDaLista>('bloquear')
  const [savingForaDaLista, setSavingForaDaLista] = useState(false)
  const [saving, setSaving] = useState(false)
  const [savedTaxa, setSavedTaxa] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Canais de venda e fluxo de conclusão. Ficam com o default conservador até a
  // config carregar (ver migration 0049).
  const [fluxo, setFluxo] = useState({ usaLogistica: true, aceitaEntrega: true, aceitaRetirada: false })
  const [savingFluxo, setSavingFluxo] = useState(false)

  const [editingId, setEditingId] = useState<string | null>(null)
  const [editBairro, setEditBairro] = useState('')
  const [editTaxa, setEditTaxa] = useState('')

  const [newBairro, setNewBairro] = useState('')
  const [newTaxa, setNewTaxa] = useState('')
  const [addingRow, setAddingRow] = useState(false)

  // Entrega por raio (faixas de km)
  const [raios, setRaios] = useState<TaxaRaio[]>([])
  const [editRaioId, setEditRaioId] = useState<string | null>(null)
  const [editRaioKm, setEditRaioKm] = useState('')
  const [editRaioTaxa, setEditRaioTaxa] = useState('')
  const [newRaioKm, setNewRaioKm] = useState('')
  const [newRaioTaxa, setNewRaioTaxa] = useState('')
  const [addingRaio, setAddingRaio] = useState(false)

  // O frete por raio precisa da posição da loja no mapa. Aqui validamos o
  // CEP/endereço cadastrado: com coordenadas ok libera as faixas; sem, bloqueia
  // e avisa — senão o raio falha em silêncio e a mensagem sobra pro cliente.
  const [coordStatus, setCoordStatus] = useState<'verificando' | 'ok' | 'falhou'>('verificando')
  const [cepLoja, setCepLoja] = useState('')

  const verificarCoordenadas = useCallback(async () => {
    setCoordStatus('verificando')
    try {
      const cfg = await buscarConfigLoja(supabase, restauranteId)
      if (!cfg) { setCoordStatus('falhou'); return }
      setCepLoja(cfg.cep)
      if (cfg.latitude != null && cfg.longitude != null) { setCoordStatus('ok'); return }
      const coord = await geocodeEndereco(
        { cep: cfg.cep || undefined, endereco: cfg.endereco || undefined },
        process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY
      )
      if (!coord) { setCoordStatus('falhou'); return }
      await salvarCoordenadasLoja(supabase, restauranteId, coord.lat, coord.lng)
      setCoordStatus('ok')
    } catch {
      setCoordStatus('falhou')
    }
  }, [supabase, restauranteId])

  useEffect(() => {
    if (loaded) return
    async function load() {
      const [cfg, rows, raioRows] = await Promise.all([
        buscarConfigLoja(supabase, restauranteId),
        listarTaxasBairro(supabase, restauranteId),
        listarTaxasRaio(supabase, restauranteId),
      ])
      if (cfg) {
        setTaxaPadrao(String(cfg.taxaEntregaPadrao))
        setTaxaPadraoSalva(cfg.taxaEntregaPadrao)
        setFreteGratis(cfg.freteGratisAcima === null ? '' : String(cfg.freteGratisAcima))
        setFreteGratisSalvo(cfg.freteGratisAcima)
        setForaDaLista(cfg.freteForaDaLista)
        setFluxo({ usaLogistica: cfg.usaLogistica, aceitaEntrega: cfg.aceitaEntrega, aceitaRetirada: cfg.aceitaRetirada })
      }
      setBairros(rows)
      setRaios(raioRows)
      setLoaded(true)
      verificarCoordenadas()
    }
    load()
  }, [supabase, restauranteId, loaded, verificarCoordenadas])

  async function addRaioRow() {
    if (coordStatus !== 'ok') {
      setError('Corrija o CEP/endereço da loja (aba Loja) antes de ativar o frete por raio — sem ele não dá pra calcular distância.')
      return
    }
    const km = parseFloat(newRaioKm.replace(',', '.'))
    if (!Number.isFinite(km) || km <= 0) { setError('Informe a distância em km da faixa (ex: 3).'); return }
    const val = parseFloat(newRaioTaxa.replace(',', '.'))
    const taxa = Number.isFinite(val) && val >= 0 ? val : 0
    setAddingRaio(true)
    setError(null)
    try {
      const row = await criarTaxaRaio(supabase, restauranteId, km, taxa)
      setRaios((prev) => [...prev, row].sort((a, b) => a.ateKm - b.ateKm))
      setNewRaioKm('')
      setNewRaioTaxa('')
    } catch {
      setError('Não foi possível adicionar a faixa de raio.')
    } finally {
      setAddingRaio(false)
    }
  }

  async function saveRaioRow(id: string) {
    const km = parseFloat(editRaioKm.replace(',', '.'))
    if (!Number.isFinite(km) || km <= 0) { setError('Informe a distância em km da faixa.'); return }
    const val = parseFloat(editRaioTaxa.replace(',', '.'))
    const taxa = Number.isFinite(val) && val >= 0 ? val : 0
    setError(null)
    try {
      await atualizarTaxaRaio(supabase, id, km, taxa)
      setRaios((prev) => prev.map((r) => (r.id === id ? { ...r, ateKm: km, taxa } : r)).sort((a, b) => a.ateKm - b.ateKm))
      setEditRaioId(null)
    } catch {
      setError('Não foi possível atualizar a faixa de raio.')
    }
  }

  async function deleteRaioRow(id: string) {
    setError(null)
    try {
      await removerTaxaRaio(supabase, id)
      setRaios((prev) => prev.filter((r) => r.id !== id))
    } catch {
      setError('Não foi possível remover a faixa de raio.')
    }
  }

  /**
   * Salva um dos toggles de fluxo. Aplica otimista (o switch responde na hora) e
   * reverte se o servidor recusar — são três chaves que mudam o que o cliente vê
   * na vitrine, então ficar "ligado" sem ter salvo seria pior que o clique perdido.
   */
  async function salvarForaDaLista(aceitar: boolean) {
    const proximo: FreteForaDaLista = aceitar ? 'taxa_padrao' : 'bloquear'
    const anterior = foraDaLista
    setForaDaLista(proximo)
    setSavingForaDaLista(true)
    setError(null)
    try {
      await atualizarConfigLoja(supabase, restauranteId, { freteForaDaLista: proximo })
    } catch {
      setForaDaLista(anterior)
      setError('Não foi possível salvar a regra de bairro fora da lista.')
    } finally {
      setSavingForaDaLista(false)
    }
  }

  async function salvarFluxo(patch: Partial<typeof fluxo>) {
    const anterior = fluxo
    const proximo = { ...fluxo, ...patch }
    // A loja precisa vender por algum canal — desligar os dois deixaria a
    // vitrine sem nenhum botão de finalizar pedido.
    if (!proximo.aceitaEntrega && !proximo.aceitaRetirada) {
      setError('A loja precisa aceitar pelo menos um canal: entrega ou retirada.')
      return
    }
    setFluxo(proximo)
    setSavingFluxo(true)
    setError(null)
    try {
      await atualizarConfigLoja(supabase, restauranteId, patch)
    } catch {
      setFluxo(anterior)
      setError('Não foi possível salvar as opções de entrega.')
    } finally {
      setSavingFluxo(false)
    }
  }

  async function saveTaxaPadrao() {
    const val = parseFloat(taxaPadrao.replace(',', '.'))
    if (!Number.isFinite(val) || val < 0) { setError('Informe um valor numérico válido para a taxa padrão (ex: 5.00).'); return }
    setSaving(true)
    setError(null)
    try {
      await atualizarConfigLoja(supabase, restauranteId, { taxaEntregaPadrao: val })
      setTaxaPadraoSalva(val)
      setSavedTaxa(true)
    } catch {
      setError('Não foi possível salvar a taxa padrão.')
    } finally {
      setSaving(false)
    }
  }

  async function saveFreteGratis() {
    const bruto = freteGratis.trim()
    let valor: number | null = null
    if (bruto !== '') {
      const val = parseFloat(bruto.replace(',', '.'))
      if (!Number.isFinite(val) || val < 0) { setError('Informe um valor válido para a entrega grátis (ex: 100.00) ou deixe em branco para desativar.'); return }
      valor = val > 0 ? val : null
    }
    setSavingFreteGratis(true)
    setError(null)
    try {
      await atualizarConfigLoja(supabase, restauranteId, { freteGratisAcima: valor })
      setFreteGratisSalvo(valor)
      setFreteGratis(valor === null ? '' : String(valor))
      setSavedFreteGratis(true)
    } catch {
      setError('Não foi possível salvar o valor mínimo de entrega grátis.')
    } finally {
      setSavingFreteGratis(false)
    }
  }

  async function addBairroRow() {
    if (!newBairro.trim()) return
    // Bairro repetido (ignorando acento e caixa) é armadilha silenciosa: o
    // cálculo do frete pega o PRIMEIRO que casar, então a segunda taxa nunca
    // vale e o lojista não entende por que o cliente pagou o valor errado.
    const jaExiste = bairros.find((b) => normalizarBairro(b.bairro) === normalizarBairro(newBairro))
    if (jaExiste) {
      setError(`"${jaExiste.bairro}" já está cadastrado. Edite a taxa dele em vez de adicionar de novo.`)
      return
    }
    const val = parseFloat(newTaxa.replace(',', '.'))
    const taxa = Number.isFinite(val) && val >= 0 ? val : 0
    setAddingRow(true)
    setError(null)
    try {
      const row = await criarTaxaBairro(supabase, restauranteId, newBairro.trim(), taxa)
      setBairros((prev) => [...prev, row])
      setNewBairro('')
      setNewTaxa('')
    } catch {
      setError('Não foi possível adicionar o bairro.')
    } finally {
      setAddingRow(false)
    }
  }

  async function saveEditRow(id: string) {
    if (!editBairro.trim()) return
    const colide = bairros.find((b) => b.id !== id && normalizarBairro(b.bairro) === normalizarBairro(editBairro))
    if (colide) {
      setError(`"${colide.bairro}" já está cadastrado — dois bairros com o mesmo nome fazem o frete usar sempre o primeiro.`)
      return
    }
    const val = parseFloat(editTaxa.replace(',', '.'))
    const taxa = Number.isFinite(val) && val >= 0 ? val : 0
    setError(null)
    try {
      await atualizarTaxaBairro(supabase, id, editBairro.trim(), taxa)
      setBairros((prev) => prev.map((b) => (b.id === id ? { ...b, bairro: editBairro.trim(), taxa } : b)))
      setEditingId(null)
    } catch {
      setError('Não foi possível atualizar o bairro.')
    }
  }

  async function deleteRow(id: string) {
    setError(null)
    try {
      await removerTaxaBairro(supabase, id)
      setBairros((prev) => prev.filter((b) => b.id !== id))
    } catch {
      setError('Não foi possível remover o bairro.')
    }
  }

  const taxaChanged = parseFloat(taxaPadrao.replace(',', '.')) !== taxaPadraoSalva

  return (
    <div className={['flex flex-1 flex-col overflow-hidden', !active ? 'hidden' : ''].join(' ')}>
      <div className="flex-1 overflow-y-auto px-5 py-6">
        <div className="max-w-xl space-y-6">
          {/* Como a loja vende e como fecha o pedido */}
          <Card>
            <h3 className="mb-1 text-[13px] font-bold text-text-main">Como a loja atende</h3>
            <p className="mb-3 text-[12px] leading-relaxed text-text-subtle">
              Define o que o cliente pode escolher no cardápio e quem encerra o pedido no painel.
            </p>
            <div className="divide-y divide-border">
              <ToggleRow
                label="Aceitar pedidos para entrega"
                hint="O cliente informa o endereço e paga a taxa de entrega."
                checked={fluxo.aceitaEntrega}
                onChange={(v) => salvarFluxo({ aceitaEntrega: v })}
                disabled={savingFluxo}
              />
              <ToggleRow
                label="Aceitar pedidos para retirada"
                hint="O cliente retira no balcão: sem endereço e sem taxa de entrega."
                checked={fluxo.aceitaRetirada}
                onChange={(v) => salvarFluxo({ aceitaRetirada: v })}
                disabled={savingFluxo}
              />
              <ToggleRow
                label="Usar o módulo de Logística"
                hint="Ligado: a entrega pronta sai do Kanban e vai para a Logística ser despachada a um entregador. Desligado: você marca “Saiu para entrega” e “Entregue” direto no Kanban, e o menu Logística some."
                checked={fluxo.usaLogistica}
                onChange={(v) => salvarFluxo({ usaLogistica: v })}
                disabled={savingFluxo}
              />
            </div>
          </Card>

          {/* Taxa padrão */}
          <Card>
            <h3 className="mb-1 text-[13px] font-bold text-text-main">Taxa padrão de entrega</h3>
            <p className="mb-3 text-[12px] leading-relaxed text-text-subtle">
              Vale para quem não tem taxa específica por bairro. Se você não cadastrou nenhum bairro nem faixa de raio,
              é essa a taxa de todo pedido de entrega.
            </p>
            <div className="flex items-center gap-3">
              <div className="w-40">
                <Input
                  value={taxaPadrao}
                  onChange={(e) => { setTaxaPadrao(e.target.value); setSavedTaxa(false) }}
                  placeholder="Ex: 5.00"
                />
              </div>
              <span className="text-sm text-text-subtle">R$</span>
              <Button variant="outline" onClick={saveTaxaPadrao} disabled={saving || !taxaChanged}>
                {saving ? 'Salvando…' : 'Salvar'}
              </Button>
            </div>
            {savedTaxa && !taxaChanged && <p className="mt-1.5 text-[12px] font-medium text-status-ready">Taxa padrão salva.</p>}

            <div className="mt-4 border-t border-border pt-1">
              <ToggleRow
                label="Aceitar bairro fora da tabela cobrando a taxa padrão"
                hint={
                  raios.length > 0
                    ? 'Sua loja usa raio: ele continua delimitando a área. Fora do raio, ou quando não dá pra localizar o endereço, o pedido segue recusado mesmo com esta opção ligada.'
                    : 'Desligado: só os bairros da tabela abaixo podem pedir entrega. Ligado: qualquer bairro pede, pagando a taxa padrão acima.'
                }
                checked={foraDaLista === 'taxa_padrao'}
                onChange={salvarForaDaLista}
                disabled={savingForaDaLista || !loaded}
              />
            </div>
          </Card>

          {/* Entrega grátis acima de um valor */}
          <Card>
            <h3 className="mb-1 text-[13px] font-bold text-text-main">Entrega grátis</h3>
            <p className="mb-3 text-[12px] leading-relaxed text-text-subtle">
              Pedidos com subtotal igual ou acima deste valor ganham entrega grátis. O aviso aparece em destaque no
              carrinho do cliente. Deixe em branco para desativar.
            </p>
            <div className="flex items-center gap-3">
              <div className="w-40">
                <Input
                  value={freteGratis}
                  onChange={(e) => { setFreteGratis(e.target.value); setSavedFreteGratis(false) }}
                  placeholder="Ex: 100.00"
                />
              </div>
              <span className="text-sm text-text-subtle">R$</span>
              <Button variant="outline" onClick={saveFreteGratis} disabled={savingFreteGratis}>
                {savingFreteGratis ? 'Salvando…' : 'Salvar'}
              </Button>
            </div>
            {savedFreteGratis && (
              <p className="mt-1.5 text-[12px] font-medium text-status-ready">
                {freteGratisSalvo === null ? 'Entrega grátis desativada.' : `Entrega grátis ativa para pedidos acima de R$ ${freteGratisSalvo.toFixed(2).replace('.', ',')}.`}
              </p>
            )}
          </Card>

          {/* Taxas por bairro */}
          <Card>
            <h3 className="mb-1 text-[13px] font-bold text-text-main">Taxas por bairro</h3>
            <p className="mb-3 text-[12px] leading-relaxed text-text-subtle">
              Quando o cliente informa o bairro no checkout, o sistema usa a taxa correspondente. Bairro que não está
              aqui só consegue pedir se a opção “aceitar bairro fora da tabela” estiver ligada acima (ou se ele cair
              numa faixa de raio).
            </p>
            <div className="overflow-hidden rounded-menuzia border border-border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-page">
                    <th className="px-3.5 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-text-subtle">Bairro</th>
                    <th className="px-3.5 py-2.5 text-right text-[11px] font-semibold uppercase tracking-wide text-text-subtle">Taxa (R$)</th>
                    <th className="w-24 px-3.5 py-2.5" />
                  </tr>
                </thead>
                <tbody>
                  {bairros.length === 0 && (
                    <tr>
                      <td colSpan={3} className="px-3.5 py-4 text-center text-[13px] text-text-subtle">
                        Nenhum bairro cadastrado. Use a linha abaixo para adicionar.
                      </td>
                    </tr>
                  )}
                  {bairros.map((b) =>
                    editingId === b.id ? (
                      <tr key={b.id} className="border-b border-border bg-primary/10">
                        <td className="px-2.5 py-2">
                          <Input value={editBairro} onChange={(e) => setEditBairro(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && saveEditRow(b.id)} className="py-1.5" />
                        </td>
                        <td className="px-2.5 py-2">
                          <Input value={editTaxa} onChange={(e) => setEditTaxa(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && saveEditRow(b.id)} className="py-1.5 text-right" />
                        </td>
                        <td className="px-2.5 py-2">
                          <div className="flex justify-end gap-1.5">
                            <button onClick={() => saveEditRow(b.id)} className="text-[12px] font-semibold text-primary hover:underline">Salvar</button>
                            <button onClick={() => setEditingId(null)} className="text-[12px] text-text-subtle hover:text-text-main">Cancelar</button>
                          </div>
                        </td>
                      </tr>
                    ) : (
                      <tr key={b.id} className="border-b border-border last:border-none hover:bg-page">
                        <td className="px-3.5 py-2.5 font-medium">{b.bairro}</td>
                        <td className="px-3.5 py-2.5 text-right tabular-nums">{b.taxa.toFixed(2).replace('.', ',')}</td>
                        <td className="px-3.5 py-2.5">
                          <div className="flex justify-end gap-2">
                            <button
                              onClick={() => { setEditingId(b.id); setEditBairro(b.bairro); setEditTaxa(String(b.taxa)) }}
                              className="text-[12px] text-text-subtle hover:text-primary"
                            >Editar</button>
                            <button onClick={() => deleteRow(b.id)} className="text-[12px] text-text-subtle hover:text-danger">Remover</button>
                          </div>
                        </td>
                      </tr>
                    )
                  )}
                  {/* Nova linha */}
                  <tr className="bg-page">
                    <td className="px-2.5 py-2">
                      <Input value={newBairro} onChange={(e) => setNewBairro(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && addBairroRow()}
                        placeholder="Nome do bairro" className="py-1.5" />
                    </td>
                    <td className="px-2.5 py-2">
                      <Input value={newTaxa} onChange={(e) => setNewTaxa(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && addBairroRow()}
                        placeholder="0,00" className="py-1.5 text-right" />
                    </td>
                    <td className="px-2.5 py-2">
                      <Button variant="outline" onClick={addBairroRow} disabled={addingRow || !newBairro.trim()} className="w-full justify-center">
                        + Adicionar
                      </Button>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </Card>

          {/* Entrega por raio (faixas de km) */}
          <Card>
            <h3 className="mb-1 text-[13px] font-bold text-text-main">Entrega por raio (km)</h3>
            <p className="mb-2 text-[12px] leading-relaxed text-text-subtle">
              Cobra o frete pela distância em linha reta entre a loja e o cliente. Defina faixas: até X km custa R$ Y.
              Endereços além da última faixa ficam fora da área de entrega.
            </p>
            <p className="mb-3 rounded-menuzia border-l-[3px] border-l-primary bg-alert-bg/60 px-3 py-2 text-[12px] text-text-main">
              <b>Vale o menor valor.</b> Se o bairro do cliente tem taxa cadastrada E o endereço está dentro de uma
              faixa de raio mais barata, o cliente paga a mais barata. Bairro fora da tabela usa só o raio.
            </p>
            {coordStatus === 'verificando' && (
              <p className="mb-3 rounded-menuzia border border-border bg-page px-3 py-2 text-[12px] text-text-subtle">
                Verificando o endereço da loja no mapa…
              </p>
            )}
            {coordStatus === 'falhou' && (
              <div className="mb-3 rounded-menuzia border border-danger bg-danger/10 px-3 py-2.5 text-[12px] text-danger">
                <p className="font-semibold">
                  Endereço da loja não localizado no mapa{cepLoja ? ` (CEP cadastrado: “${cepLoja}”)` : ' (sem CEP cadastrado)'}.
                </p>
                <p className="mt-1 text-text-main">
                  Sem a posição da loja não dá pra calcular distância — o frete por raio fica <b>desativado</b>
                  {raios.length > 0 ? ' e as faixas abaixo não funcionam' : ''}. Corrija o CEP/endereço na aba <b>Loja</b> e
                  verifique de novo.
                </p>
                <button onClick={verificarCoordenadas} className="mt-2 rounded-menuzia border border-danger px-3 py-1.5 text-[12px] font-semibold text-danger transition-colors hover:bg-danger hover:text-white">
                  Verificar de novo
                </button>
              </div>
            )}
            <div className="overflow-hidden rounded-menuzia border border-border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-page">
                    <th className="px-3.5 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-text-subtle">Até (km)</th>
                    <th className="px-3.5 py-2.5 text-right text-[11px] font-semibold uppercase tracking-wide text-text-subtle">Taxa (R$)</th>
                    <th className="w-24 px-3.5 py-2.5" />
                  </tr>
                </thead>
                <tbody>
                  {raios.length === 0 && (
                    <tr>
                      <td colSpan={3} className="px-3.5 py-4 text-center text-[13px] text-text-subtle">
                        Nenhuma faixa cadastrada. Use a linha abaixo para adicionar.
                      </td>
                    </tr>
                  )}
                  {raios.map((r) =>
                    editRaioId === r.id ? (
                      <tr key={r.id} className="border-b border-border bg-primary/10">
                        <td className="px-2.5 py-2">
                          <Input value={editRaioKm} onChange={(e) => setEditRaioKm(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && saveRaioRow(r.id)} className="py-1.5" />
                        </td>
                        <td className="px-2.5 py-2">
                          <Input value={editRaioTaxa} onChange={(e) => setEditRaioTaxa(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && saveRaioRow(r.id)} className="py-1.5 text-right" />
                        </td>
                        <td className="px-2.5 py-2">
                          <div className="flex justify-end gap-1.5">
                            <button onClick={() => saveRaioRow(r.id)} className="text-[12px] font-semibold text-primary hover:underline">Salvar</button>
                            <button onClick={() => setEditRaioId(null)} className="text-[12px] text-text-subtle hover:text-text-main">Cancelar</button>
                          </div>
                        </td>
                      </tr>
                    ) : (
                      <tr key={r.id} className="border-b border-border last:border-none hover:bg-page">
                        <td className="px-3.5 py-2.5 font-medium tabular-nums">até {r.ateKm.toString().replace('.', ',')} km</td>
                        <td className="px-3.5 py-2.5 text-right tabular-nums">{r.taxa.toFixed(2).replace('.', ',')}</td>
                        <td className="px-3.5 py-2.5">
                          <div className="flex justify-end gap-2">
                            <button
                              onClick={() => { setEditRaioId(r.id); setEditRaioKm(String(r.ateKm)); setEditRaioTaxa(String(r.taxa)) }}
                              className="text-[12px] text-text-subtle hover:text-primary"
                            >Editar</button>
                            <button onClick={() => deleteRaioRow(r.id)} className="text-[12px] text-text-subtle hover:text-danger">Remover</button>
                          </div>
                        </td>
                      </tr>
                    )
                  )}
                  {/* Nova faixa */}
                  <tr className="bg-page">
                    <td className="px-2.5 py-2">
                      <Input value={newRaioKm} onChange={(e) => setNewRaioKm(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && addRaioRow()}
                        placeholder="Ex: 3" className="py-1.5" />
                    </td>
                    <td className="px-2.5 py-2">
                      <Input value={newRaioTaxa} onChange={(e) => setNewRaioTaxa(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && addRaioRow()}
                        placeholder="0,00" className="py-1.5 text-right" />
                    </td>
                    <td className="px-2.5 py-2">
                      <Button
                        variant="outline"
                        onClick={addRaioRow}
                        disabled={addingRaio || !newRaioKm.trim() || coordStatus !== 'ok'}
                        title={coordStatus !== 'ok' ? 'Endereço da loja sem localização no mapa — corrija na aba Loja para liberar o frete por raio.' : undefined}
                        className="w-full justify-center"
                      >
                        + Adicionar
                      </Button>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </Card>

          {error && <p className="rounded-menuzia border border-danger bg-danger/10 px-3 py-2 text-[13px] text-danger">{error}</p>}
        </div>
      </div>
    </div>
  )
}

// ─── Aba Conta ────────────────────────────────────────────────────────────────

function TabConta({ active }: { active: boolean }) {
  const supabase = useMemo(() => getBrowserSupabase(), [])
  const [novaSenha, setNovaSenha] = useState('')
  const [confirmarSenha, setConfirmarSenha] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function salvar() {
    setError(null)
    if (novaSenha.length < 6) { setError('A senha deve ter no mínimo 6 caracteres.'); return }
    if (novaSenha !== confirmarSenha) { setError('As senhas não coincidem.'); return }
    setSaving(true)
    try {
      const { error } = await supabase.auth.updateUser({ password: novaSenha })
      if (error) throw error
      setNovaSenha('')
      setConfirmarSenha('')
      setSaved(true)
    } catch {
      setError('Não foi possível alterar a senha. Tente novamente.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className={['flex flex-1 flex-col overflow-hidden', !active ? 'hidden' : ''].join(' ')}>
      <div className="flex-1 overflow-y-auto px-5 py-6">
        <Card className="mb-5 max-w-xl">
          <h3 className="mb-1 text-[13px] font-bold text-text-main">Aplicativo Menuzia (atalho)</h3>
          <p className="mb-3 text-[12px] leading-relaxed text-text-subtle">
            Instale o painel como aplicativo na área de trabalho / tela inicial — abre em janela
            própria, sem a barra do navegador, com o ícone da Menuzia. Normalmente o navegador
            oferece a instalação sozinho; se não aparecer, use o botão abaixo.
          </p>
          <InstalarAppButton />
        </Card>
        <Card className="max-w-xl space-y-5">
          <div>
            <h3 className="mb-0.5 text-[13px] font-bold text-text-main">Alterar senha</h3>
            <p className="mb-3 text-[12px] leading-relaxed text-text-subtle">
              Defina uma nova senha de acesso ao painel. Você continuará logado nesta sessão.
            </p>
          </div>
          <Field label="Nova senha">
            <Input
              type="password"
              // Sem isto o navegador oferece a senha SALVA da loja e preenche os dois
              // campos com ela: quem só passou pela tela acaba "trocando" a senha por
              // ela mesma, e o gerenciador guarda uma senha que ninguém escolheu.
              autoComplete="new-password"
              value={novaSenha}
              onChange={(e) => { setNovaSenha(e.target.value); setSaved(false) }}
              placeholder="Mínimo 6 caracteres"
            />
          </Field>
          <Field label="Confirmar nova senha">
            <Input
              type="password"
              autoComplete="new-password"
              value={confirmarSenha}
              onChange={(e) => { setConfirmarSenha(e.target.value); setSaved(false) }}
              placeholder="Repita a nova senha"
            />
          </Field>
          {error && <p className="rounded-menuzia border border-danger bg-danger/10 px-3 py-2 text-[13px] text-danger">{error}</p>}
        </Card>
      </div>
      <SaveBar saved={saved} saving={saving} onSave={salvar} />
    </div>
  )
}

// ─── Aba Aparência ────────────────────────────────────────────────────────────

function TabAparencia({ restauranteId, active }: { restauranteId: string; active: boolean }) {
  const supabase = useMemo(() => getBrowserSupabase(), [])
  const [loaded, setLoaded] = useState(false)
  const [corSelecionada, setCorSelecionada] = useState<string>('azul')
  const [corCustom, setCorCustom] = useState<string>('#008fba')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (loaded) return
    buscarConfigLoja(supabase, restauranteId).then((c) => {
      if (!c) return
      const cor = c.corTema ?? 'azul'
      if (cor.startsWith('#')) { setCorSelecionada('custom'); setCorCustom(cor) }
      else setCorSelecionada(cor)
      setLoaded(true)
    })
  }, [supabase, restauranteId, loaded])

  const paleta = corSelecionada === 'custom' ? temaCores(corCustom) : (PALETAS[corSelecionada] ?? PALETAS.azul)

  async function salvar() {
    setSaving(true)
    setError(null)
    try {
      await atualizarConfigLoja(supabase, restauranteId, { corTema: corSelecionada === 'custom' ? corCustom : corSelecionada })
      setSaved(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao salvar')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className={['flex flex-1 flex-col overflow-hidden', !active ? 'hidden' : ''].join(' ')}>
      <div className="flex-1 overflow-y-auto px-5 py-6">
        <Card className="max-w-xl space-y-6">
          <div>
            <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-text-subtle">Paleta de cores</p>
            <p className="mb-4 text-[13px] text-text-subtle">Define a cor primária do cardápio digital dos seus clientes — botões, chips de categoria, destaques e ícones.</p>
            <div className="grid grid-cols-5 gap-x-3 gap-y-4">
              {Object.entries(PALETAS).map(([key, p]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => { setCorSelecionada(key); setSaved(false) }}
                  className="flex flex-col items-center gap-1.5 group"
                >
                  <div
                    className="h-10 w-10 rounded-full border-2 transition-all duration-150 group-hover:scale-110"
                    style={{
                      background: `linear-gradient(135deg, ${p.from}, ${p.primaria})`,
                      borderColor: corSelecionada === key ? p.primaria : 'transparent',
                      boxShadow: corSelecionada === key ? `0 0 0 3px white, 0 0 0 5px ${p.primaria}` : undefined,
                      transform: corSelecionada === key ? 'scale(1.12)' : undefined,
                    }}
                  />
                  <span className="text-[10px] font-semibold text-text-subtle text-center leading-tight">{p.nome}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="rounded-menuzia border border-border p-4">
            <p className="mb-3 text-[11px] font-semibold uppercase tracking-wide text-text-subtle">Cor personalizada</p>
            <div className="flex items-center gap-4">
              <label className="relative cursor-pointer flex-shrink-0">
                <div
                  className="h-12 w-12 rounded-full border-2 transition-all"
                  style={{
                    background: `linear-gradient(135deg, ${temaCores(corCustom).from}, ${corCustom})`,
                    borderColor: corSelecionada === 'custom' ? corCustom : 'transparent',
                    boxShadow: corSelecionada === 'custom' ? `0 0 0 3px white, 0 0 0 5px ${corCustom}` : undefined,
                    transform: corSelecionada === 'custom' ? 'scale(1.1)' : undefined,
                  }}
                />
                <input
                  type="color"
                  value={corCustom}
                  onChange={(e) => { setCorCustom(e.target.value); setCorSelecionada('custom'); setSaved(false) }}
                  className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                />
              </label>
              <div className="flex-1">
                <p className="text-sm font-semibold">Hex personalizado</p>
                <p className="mt-0.5 font-mono text-[12px] text-text-subtle">{corCustom.toUpperCase()}</p>
                <p className="mt-1 text-[11px] text-text-subtle">Clique no círculo para escolher qualquer cor</p>
              </div>
              {corSelecionada === 'custom' && (
                <span className="flex-shrink-0 rounded px-2.5 py-1 text-[11px] font-bold text-white" style={{ backgroundColor: corCustom }}>Ativa</span>
              )}
            </div>
          </div>

          <div>
            <p className="mb-3 text-[11px] font-semibold uppercase tracking-wide text-text-subtle">Pré-visualização</p>
            <div className="flex flex-wrap items-center gap-2 rounded-menuzia border border-border bg-page p-4">
              <button
                type="button"
                className="rounded-menuzia px-4 py-2 text-[12px] font-bold uppercase tracking-wide text-white transition-colors"
                style={{ backgroundColor: paleta.primaria }}
              >
                Adicionar
              </button>
              <button
                type="button"
                className="rounded-menuzia border px-4 py-2 text-[12px] font-bold uppercase tracking-wide transition-colors"
                style={{ borderColor: paleta.primaria, color: paleta.primaria, backgroundColor: paleta.light }}
              >
                Ver cardápio
              </button>
              <span
                className="rounded-full px-3 py-1 text-[12px] font-semibold"
                style={{ backgroundColor: paleta.light, color: paleta.primaria }}
              >
                Lanches
              </span>
              <span
                className="rounded-full px-3 py-1 text-[12px] font-semibold"
                style={{ backgroundColor: paleta.primaria, color: '#fff' }}
              >
                Combos
              </span>
            </div>
          </div>

          {error && <p className="rounded-menuzia border border-danger bg-danger/10 px-3 py-2 text-[13px] text-danger">{error}</p>}
        </Card>
      </div>
      <SaveBar saved={saved} saving={saving} onSave={salvar} />
    </div>
  )
}

// ─── Aba Cozinha (Estações) ───────────────────────────────────────────────────

const MODO_BADGE: Record<ModoEstacao, string> = {
  producao:  'bg-status-pending/10 text-status-pending',
  expedicao: 'bg-status-preparing/10 text-status-preparing',
  completa:  'bg-status-ready/10 text-status-ready',
}

function TabEstacoes({ restauranteId, active }: { restauranteId: string; active: boolean }) {
  const supabase = useMemo(() => getBrowserSupabase(), [])
  const [loaded, setLoaded] = useState(false)
  const [estacoes, setEstacoes] = useState<Estacao[]>([])
  const [novaEstacaoNome, setNovaEstacaoNome] = useState('')
  const [novaEstacaoModo, setNovaEstacaoModo] = useState<ModoEstacao>('producao')
  const [error, setError] = useState<string | null>(null)
  // Per-station UI state
  const [copiadoId, setCopiadoId] = useState<string | null>(null)
  const [qrData, setQrData] = useState<Record<string, string>>({})
  const [qrOpen, setQrOpen] = useState<Record<string, boolean>>({})

  const carregarEstacoes = useCallback(async (rid: string) => {
    try {
      setEstacoes(await listarEstacoes(supabase, rid))
    } catch {
      // silently ignore — polling may fail if offline
    }
  }, [supabase])

  useEffect(() => {
    if (!active) return
    if (!loaded) {
      carregarEstacoes(restauranteId).then(() => setLoaded(true))
    }
    const t = setInterval(() => carregarEstacoes(restauranteId), 10000)
    return () => clearInterval(t)
  }, [active, loaded, restauranteId, carregarEstacoes])

  async function handleCriarEstacao() {
    if (!novaEstacaoNome.trim()) return
    setError(null)
    try {
      await criarEstacao(supabase, restauranteId, novaEstacaoNome.trim(), novaEstacaoModo)
      setNovaEstacaoNome('')
      await carregarEstacoes(restauranteId)
    } catch {
      setError('Não foi possível criar a estação.')
    }
  }

  async function handleToggleEstacao(e: Estacao) {
    setError(null)
    try {
      await atualizarEstacao(supabase, e.id, { ativo: !e.ativo })
      await carregarEstacoes(restauranteId)
    } catch {
      setError('Não foi possível atualizar a estação.')
    }
  }

  async function handleRotacionar(e: Estacao) {
    setError(null)
    try {
      await rotacionarTokenEstacao(supabase, e.id)
      // Clear cached QR for this station so it regenerates with the new token
      setQrData((prev) => { const next = { ...prev }; delete next[e.id]; return next })
      setQrOpen((prev) => ({ ...prev, [e.id]: false }))
      await carregarEstacoes(restauranteId)
    } catch {
      setError('Não foi possível rotacionar o token.')
    }
  }

  async function handleRemoverEstacao(e: Estacao) {
    if (!confirm(`Remover a estação "${e.nome}"? O link atual deixa de funcionar.`)) return
    setError(null)
    try {
      await removerEstacao(supabase, e.id)
      await carregarEstacoes(restauranteId)
    } catch {
      setError('Não foi possível remover a estação.')
    }
  }

  function handleCopiar(e: Estacao) {
    if (typeof window === 'undefined') return
    const url = `${window.location.origin}/cozinha/${e.token}`
    navigator.clipboard.writeText(url).then(() => {
      setCopiadoId(e.id)
      setTimeout(() => setCopiadoId((prev) => (prev === e.id ? null : prev)), 1500)
    })
  }

  async function handleToggleQr(e: Estacao) {
    const nowOpen = !qrOpen[e.id]
    setQrOpen((prev) => ({ ...prev, [e.id]: nowOpen }))
    if (nowOpen && !qrData[e.id]) {
      try {
        const url = typeof window !== 'undefined'
          ? `${window.location.origin}/cozinha/${e.token}`
          : `/cozinha/${e.token}`
        const dataUrl = await QRCode.toDataURL(url, { width: 240, margin: 1 })
        setQrData((prev) => ({ ...prev, [e.id]: dataUrl }))
      } catch {
        // silently ignore
      }
    }
  }

  return (
    <div className={['flex flex-1 flex-col overflow-hidden', !active ? 'hidden' : ''].join(' ')}>
      <div className="flex-1 overflow-y-auto px-5 py-6">
        <div className="max-w-xl space-y-6">
          {/* Create form */}
          <Card>
            <h3 className="mb-1 text-[13px] font-bold text-text-main">Estações de cozinha</h3>
            <p className="mb-4 text-[12px] leading-relaxed text-text-subtle">
              Crie um acesso por link para a cozinha usar no celular ou tablet. Cada estação vê só a sua etapa.
            </p>
            <div className="flex flex-wrap items-end gap-2">
              <input
                value={novaEstacaoNome}
                onChange={(e) => setNovaEstacaoNome(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleCriarEstacao()}
                placeholder="Nome (ex.: Chapa, Expedição)"
                className="h-9 min-w-0 flex-1 rounded-menuzia border border-border bg-white px-3 text-sm outline-none focus:border-primary placeholder:text-text-subtle/60"
              />
              <select
                value={novaEstacaoModo}
                onChange={(e) => setNovaEstacaoModo(e.target.value as ModoEstacao)}
                className="h-9 rounded-menuzia border border-border bg-white px-2 text-sm outline-none focus:border-primary"
              >
                {MODOS.map((m) => <option key={m} value={m}>{LABEL_MODO[m]}</option>)}
              </select>
              <button
                onClick={handleCriarEstacao}
                disabled={!novaEstacaoNome.trim()}
                className="h-9 rounded-menuzia bg-primary px-4 text-[11px] font-semibold uppercase tracking-wide text-white transition-colors hover:bg-primary-dark disabled:opacity-50"
              >
                Criar estação
              </button>
            </div>
          </Card>

          {/* Station cards */}
          <div className="space-y-3">
            {estacoes.length === 0 && (
              <div className="rounded-menuzia border border-dashed border-border bg-white px-4 py-6 text-center text-[13px] text-text-subtle">
                Nenhuma estação criada ainda. Use o formulário acima para criar a primeira.
              </div>
            )}
            {estacoes.map((e) => {
              const url = typeof window !== 'undefined'
                ? `${window.location.origin}/cozinha/${e.token}`
                : `/cozinha/${e.token}`
              const isCopied = copiadoId === e.id
              const isQrOpen = !!qrOpen[e.id]
              return (
                <div
                  key={e.id}
                  className={['overflow-hidden rounded-menuzia border border-border bg-white', !e.ativo ? 'opacity-60' : ''].join(' ')}
                >
                  {/* Card header */}
                  <div className="flex items-center gap-2.5 border-b border-border px-4 py-3">
                    <span
                      title={e.online ? 'Online' : 'Offline'}
                      className={`h-2.5 w-2.5 flex-shrink-0 rounded-full ${e.online ? 'bg-status-ready' : 'bg-text-subtle'}`}
                    />
                    <span className="min-w-0 flex-1 truncate text-[14px] font-semibold text-text-main">{e.nome}</span>
                    <span className={`flex-shrink-0 rounded-menuzia px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${MODO_BADGE[e.modo]}`}>
                      {LABEL_MODO[e.modo]}
                    </span>
                    {!e.ativo && (
                      <span className="flex-shrink-0 rounded-menuzia bg-page px-1.5 py-0.5 text-[10px] font-semibold uppercase text-text-subtle">
                        Inativa
                      </span>
                    )}
                  </div>

                  {/* Card body */}
                  <div className="space-y-2.5 px-4 py-3">
                    {/* Link row — min-w-0 + overflow-hidden prevent URL from expanding the card */}
                    <div className="flex min-w-0 items-center gap-2 overflow-hidden rounded-menuzia border border-border bg-page px-3 py-1.5">
                      <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-text-subtle">{url}</span>
                      <button
                        onClick={() => handleCopiar(e)}
                        title={isCopied ? 'Copiado!' : 'Copiar link'}
                        className={[
                          'flex flex-shrink-0 items-center gap-1 rounded-menuzia px-2 py-1 text-[11px] font-semibold transition-colors',
                          isCopied ? 'text-status-ready' : 'text-primary hover:bg-primary/10',
                        ].join(' ')}
                      >
                        {isCopied ? <Check size={13} /> : <Copy size={13} />}
                        {isCopied ? 'Copiado!' : 'Copiar'}
                      </button>
                    </div>

                    {/* QR code toggle */}
                    <div>
                      <button
                        onClick={() => handleToggleQr(e)}
                        className="flex items-center gap-1.5 text-[12px] font-semibold text-text-subtle transition-colors hover:text-text-main"
                      >
                        <QrCode size={14} />
                        {isQrOpen ? 'Ocultar QR Code' : 'Ver QR Code'}
                      </button>
                      {isQrOpen && (
                        <div className="mt-2.5">
                          {qrData[e.id] ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={qrData[e.id]}
                              alt={`QR Code — ${e.nome}`}
                              className="h-[120px] w-[120px] rounded-menuzia border border-border"
                            />
                          ) : (
                            <div className="flex h-[120px] w-[120px] items-center justify-center rounded-menuzia border border-border bg-page text-[11px] text-text-subtle">
                              Gerando…
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Card footer */}
                  <div className="flex items-center gap-3 border-t border-border px-4 py-2.5">
                    <button
                      onClick={() => handleToggleEstacao(e)}
                      className={[
                        'text-[11px] font-semibold uppercase tracking-wide transition-colors',
                        e.ativo ? 'text-text-subtle hover:text-text-main' : 'text-primary hover:underline',
                      ].join(' ')}
                    >
                      {e.ativo ? 'Desativar' : 'Ativar'}
                    </button>
                    <span className="select-none text-border">·</span>
                    <button
                      onClick={() => handleRotacionar(e)}
                      className="text-[11px] font-semibold uppercase tracking-wide text-warn transition-colors hover:underline"
                    >
                      Novo link
                    </button>
                    <span className="flex-1" />
                    <button
                      onClick={() => handleRemoverEstacao(e)}
                      className="text-[11px] font-semibold uppercase tracking-wide text-danger transition-colors hover:underline"
                    >
                      Excluir
                    </button>
                  </div>
                </div>
              )
            })}
          </div>

          {error && (
            <p className="rounded-menuzia border border-danger bg-danger/10 px-3 py-2 text-[13px] text-danger">
              {error}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Aba Mesas ────────────────────────────────────────────────────────────────

function TabMesas({ restauranteId, active }: { restauranteId: string; active: boolean }) {
  const supabase = useMemo(() => getBrowserSupabase(), [])
  const [loaded, setLoaded] = useState(false)
  const [mesas, setMesas] = useState<Mesa[]>([])
  const [nomes, setNomes] = useState<Record<string, string>>({})
  const [novaMesa, setNovaMesa] = useState('')
  const [adding, setAdding] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Com o módulo ligado, esta aba é só configuração: cadastro e operação das mesas vão
  // para "Mesas e Comandas". Desligado, o cadastro simples continua aqui para o PDV.
  const [moduloAtivo, setModuloAtivo] = useState<boolean | null>(null)

  useEffect(() => {
    if (!active) return
    if (loaded) return
    listarMesas(supabase, restauranteId)
      .then((rows) => {
        setMesas(rows)
        setNomes(Object.fromEntries(rows.map((m) => [m.id, m.nome])))
        setLoaded(true)
      })
      .catch(() => {
        setError('Não foi possível carregar as mesas.')
      })
  }, [active, supabase, restauranteId, loaded])

  async function handleAdicionar() {
    if (!novaMesa.trim()) return
    setAdding(true)
    setError(null)
    try {
      await criarMesa(supabase, restauranteId, { nome: novaMesa.trim(), ordem: mesas.length })
      const all = await listarMesas(supabase, restauranteId)
      setMesas(all)
      setNomes(Object.fromEntries(all.map((m) => [m.id, m.nome])))
      setNovaMesa('')
    } catch {
      setError('Não foi possível adicionar a mesa.')
    } finally {
      setAdding(false)
    }
  }

  async function handleRenomear(id: string) {
    const nome = (nomes[id] ?? '').trim()
    if (!nome) return
    const mesa = mesas.find((m) => m.id === id)
    if (!mesa || mesa.nome === nome) return
    setError(null)
    try {
      await atualizarMesa(supabase, id, { nome })
      setMesas((prev) => prev.map((m) => (m.id === id ? { ...m, nome } : m)))
    } catch {
      setError('Não foi possível renomear a mesa.')
    }
  }

  async function handleToggleAtiva(m: Mesa) {
    setError(null)
    try {
      await atualizarMesa(supabase, m.id, { ativa: !m.ativa })
      setMesas((prev) => prev.map((x) => (x.id === m.id ? { ...x, ativa: !m.ativa } : x)))
    } catch (e) {
      // O banco (0071) recusa pausar mesa com conta aberta, venha de onde vier.
      setError(/comanda_aberta/.test(String((e as { message?: string })?.message))
        ? 'Esta mesa tem conta aberta. Feche ou transfira a conta antes de pausar.'
        : 'Não foi possível atualizar a mesa.')
    }
  }

  async function handleRemover(m: Mesa) {
    if (!confirm(`Remover a mesa "${m.nome}"?`)) return
    setError(null)
    try {
      await removerMesa(supabase, m.id)
      setMesas((prev) => prev.filter((x) => x.id !== m.id))
      setNomes((prev) => { const n = { ...prev }; delete n[m.id]; return n })
    } catch (e) {
      // Mesa com histórico de contas não some (0071): pausar em vez de excluir.
      setError(/mesa_com_historico/.test(String((e as { message?: string })?.message))
        ? 'Esta mesa tem histórico de contas e não pode ser excluída. Pause-a em vez disso.'
        : 'Não foi possível remover a mesa.')
    }
  }

  return (
    <div className={['flex flex-1 flex-col overflow-hidden', !active ? 'hidden' : ''].join(' ')}>
      <div className="flex-1 overflow-y-auto px-5 py-6">
        <div className="max-w-xl space-y-6">
          <CardModuloMesas onEstado={setModuloAtivo} />

          {moduloAtivo === true && (
            <>
              <ConfigConta embutida />
              <CardapioDaMesaConfig />
              <Card>
                <h3 className="mb-1 text-[13px] font-bold text-text-main">Cadastro das mesas</h3>
                <p className="text-[12px] leading-relaxed text-text-subtle">
                  Com o módulo ligado, cadastrar, editar, bloquear e gerar o QR de cada mesa é feito em{' '}
                  <strong className="text-text-main">Mesas e Comandas</strong>, no menu lateral — junto do salão, das
                  contas e dos chamados.
                </p>
              </Card>
            </>
          )}

          {moduloAtivo === false && (
          <>
          <Card>
            <h3 className="mb-1 text-[13px] font-bold text-text-main">Mesas</h3>
            <p className="mb-4 text-[12px] leading-relaxed text-text-subtle">
              Cadastre as mesas do estabelecimento para uso no PDV de balcão.
            </p>
            <div className="flex items-center gap-2">
              <div className="flex-1">
                <Input
                  value={novaMesa}
                  onChange={(e) => setNovaMesa(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleAdicionar()}
                  placeholder="Nome da mesa (ex.: Mesa 1)"
                />
              </div>
              <Button variant="outline" onClick={handleAdicionar} disabled={adding || !novaMesa.trim()}>
                {adding ? 'Adicionando…' : 'Adicionar'}
              </Button>
            </div>
          </Card>

          {loaded && (
            <Card>
              {mesas.length === 0 ? (
                <p className="py-2 text-[13px] text-text-subtle">Nenhuma mesa cadastrada ainda.</p>
              ) : (
                <div className="divide-y divide-border">
                  {mesas.map((m) => (
                    <div key={m.id} className="flex items-center gap-3 py-2.5">
                      <input
                        value={nomes[m.id] ?? m.nome}
                        onChange={(e) => setNomes((prev) => ({ ...prev, [m.id]: e.target.value }))}
                        onBlur={() => handleRenomear(m.id)}
                        className="min-w-0 flex-1 rounded-menuzia border border-transparent bg-transparent px-2 py-1 text-[13px] font-medium text-text-main outline-none transition-colors hover:border-border focus:border-primary focus:bg-white"
                      />
                      <button
                        onClick={() => handleToggleAtiva(m)}
                        className={[
                          'flex-shrink-0 rounded-menuzia px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide transition-colors',
                          m.ativa
                            ? 'bg-status-ready/10 text-status-ready hover:bg-status-ready/20'
                            : 'bg-page text-text-subtle hover:bg-border',
                        ].join(' ')}
                      >
                        {m.ativa ? 'Ativa' : 'Pausada'}
                      </button>
                      <button
                        onClick={() => handleRemover(m)}
                        className="flex-shrink-0 text-[12px] text-text-subtle transition-colors hover:text-danger"
                      >
                        Excluir
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          )}
          </>
          )}

          {error && (
            <p className="rounded-menuzia border border-danger bg-danger/10 px-3 py-2 text-[13px] text-danger">
              {error}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Página principal ─────────────────────────────────────────────────────────

export default function AjustesPage() {
  const supabase = useMemo(() => getBrowserSupabase(), [])
  const [restauranteId, setRestauranteId] = useState<string | null>(null)
  const [tab, setTab] = useState<Tab>('loja')

  useEffect(() => {
    buscarRestauranteIdDoUsuario(supabase).then(setRestauranteId)
  }, [supabase])

  // A Impressão tem uma página só (menu lateral). Link antigo (?aba=impressao) vai para ela.
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('aba') === 'impressao') window.location.replace('/admin/impressao')
  }, [])

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <TopBar title="Ajustes" breadcrumb="Configurações da loja" />

      {/* Tab bar */}
      {/* Submenu: coluna no desktop, trilho rolável no celular. Mesmos destinos
          e mesmos nomes de antes — com oito abas, a fila horizontal empurrava as
          últimas para fora da tela. */}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden lg:flex-row">
        <SubmenuVertical itens={TABS} ativo={tab} onSelecionar={setTab} titulo="Seções dos ajustes" />

        {/* Conteúdo — todas as abas montadas, só a ativa visível (preserva o
            estado do formulário ao trocar de seção). */}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          {!restauranteId ? (
            <div className="flex flex-1 items-center justify-center text-sm text-text-subtle">Carregando…</div>
          ) : (
            <>
              <TabLoja restauranteId={restauranteId} active={tab === 'loja'} />
              <TabEntrega restauranteId={restauranteId} active={tab === 'entrega'} />
              <TabMesas restauranteId={restauranteId} active={tab === 'mesas'} />
              <TabQrCode restauranteId={restauranteId} active={tab === 'qrcode'} />
              <TabAparencia restauranteId={restauranteId} active={tab === 'aparencia'} />
              <TabEstacoes restauranteId={restauranteId} active={tab === 'cozinha'} />
              <TabConta active={tab === 'conta'} />
            </>
          )}
        </div>
      </div>
    </div>
  )
}
