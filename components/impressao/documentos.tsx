'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Field, Input } from '@/components/admin/campos-ajustes'
import type { ImpressoraInput } from '@/lib/queries/impressao'

/**
 * Documentos do Assistente de Impressão atual: impressoras cadastradas (papel, fonte,
 * cópias) e a prévia FIEL da ficha da cozinha. Vieram da antiga aba Ajustes › Impressão sem
 * mudança de lógica — a Impressão agora tem uma página só.
 */

const TAMANHOS_FONTE = [
  { value: 'grande', label: 'Grande (recomendado)' },
  { value: 'media', label: 'Média' },
  { value: 'pequena', label: 'Pequena (mais conteúdo por linha)' },
]
// Largura do papel -> nº de colunas base (a fonte escala a partir disso).
const LARGURAS_PAPEL = [
  { value: 48, label: '80mm (padrão)' },
  { value: 32, label: '58mm (bobina pequena)' },
]

export const IMPRESSORA_VAZIA: ImpressoraInput = { nome: '', tamanhoFonte: 'grande', largura: 48, copias: 1 }

export function ImpressoraModal({
  initial,
  onSave,
  onClose,
}: {
  initial: ImpressoraInput
  onSave: (input: ImpressoraInput) => Promise<void>
  onClose: () => void
}) {
  const [form, setForm] = useState<ImpressoraInput>(initial)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSave() {
    if (!form.nome.trim()) {
      setError('Dê um nome para a impressora.')
      return
    }
    setSaving(true)
    setError(null)
    try {
      await onSave(form)
    } catch {
      setError('Não foi possível salvar a impressora.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-menuzia bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-border px-4.5 py-3.5">
          <h3 className="text-[15px] font-bold">Editar impressora</h3>
          <button onClick={onClose} className="flex h-[28px] w-[28px] items-center justify-center rounded-menuzia bg-page text-lg text-text-subtle hover:bg-border">×</button>
        </div>
        <div className="space-y-3.5 p-4.5">
          <Field label="Nome da impressora" hint="Só um apelido pra você identificar (ex.: Cozinha, Balcão).">
            <Input value={form.nome} onChange={(e) => setForm((p) => ({ ...p, nome: e.target.value }))} placeholder="Ex: Impressora Padrão" />
          </Field>
          <div className="flex gap-3">
            <div className="flex-1">
              <Field label="Tamanho da fonte" hint="'Grande' = letras maiores. Use 'Grande' pra recibo bem legível.">
                <select value={form.tamanhoFonte} onChange={(e) => setForm((p) => ({ ...p, tamanhoFonte: e.target.value }))}
                  className="w-full rounded-menuzia border border-border bg-white px-3 py-2.5 text-sm outline-none focus:border-primary">
                  {TAMANHOS_FONTE.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
              </Field>
            </div>
            <div className="flex-1">
              <Field label="Largura do papel" hint="A bobina que você usa.">
                <select value={form.largura} onChange={(e) => setForm((p) => ({ ...p, largura: Number(e.target.value) }))}
                  className="w-full rounded-menuzia border border-border bg-white px-3 py-2.5 text-sm outline-none focus:border-primary">
                  {LARGURAS_PAPEL.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
                </select>
              </Field>
            </div>
          </div>
          <Field label="Cópias impressas por pedido">
            <Input type="number" min={1} max={5} value={form.copias} onChange={(e) => setForm((p) => ({ ...p, copias: Number(e.target.value) || 1 }))} />
          </Field>
          {error && <p className="rounded-menuzia border border-danger bg-danger/10 px-3 py-2 text-[13px] text-danger">{error}</p>}
        </div>
        <div className="flex gap-2.5 border-t border-border p-4.5">
          <Button variant="secondary" className="flex-1" onClick={onClose} disabled={saving}>Cancelar</Button>
          <Button className="flex-1" onClick={handleSave} disabled={saving}>{saving ? 'Salvando…' : 'Salvar'}</Button>
        </div>
      </div>
    </div>
  )
}
