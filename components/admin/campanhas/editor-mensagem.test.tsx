import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { EditorMensagem, htmlParaTexto, textoParaHtml } from './editor-mensagem'

/** 04/11/2026: o editor mostra negrito/itálico/riscado e variáveis como marcação visual; grava a sintaxe do WhatsApp. */

function ida(texto: string): string {
  const div = document.createElement('div')
  div.innerHTML = textoParaHtml(texto)
  return htmlParaTexto(div)
}

describe('textoParaHtml / htmlParaTexto', () => {
  it('negrito, itálico e riscado viram tags e voltam iguais', () => {
    const html = textoParaHtml('Oi *grande* _dia_ ~velho~')
    expect(html).toContain('<b>grande</b>')
    expect(html).toContain('<i>dia</i>')
    expect(html).toContain('<s>velho</s>')
    expect(ida('Oi *grande* _dia_ ~velho~')).toBe('Oi *grande* _dia_ ~velho~')
  })

  it('variáveis viram etiqueta com o nome legível e voltam como {variavel}', () => {
    const html = textoParaHtml('Oi {nome}, veja {link_cardapio}')
    expect(html).toContain('data-var="{nome}"')
    expect(html).toContain('Nome do cliente')
    expect(html).toContain('contenteditable="false"')
    expect(ida('Oi {nome}, veja {link_cardapio} e {link} na {loja}')).toBe('Oi {nome}, veja {link_cardapio} e {link} na {loja}')
  })

  it('link próprio vira etiqueta e volta como o endereço inteiro (com _ e * dentro)', () => {
    const url = 'https://exemplo.com.br/a_b*c?x=1&y=2'
    const html = textoParaHtml(`Veja ${url} agora`)
    expect(html).toContain('data-raw=')
    expect(html).not.toContain('<i>')
    expect(ida(`Veja ${url} agora`)).toBe(`Veja ${url} agora`)
  })

  it('quebras de linha (inclusive linha vazia) voltam iguais', () => {
    expect(ida('linha 1\n\nlinha 3\nlinha 4')).toBe('linha 1\n\nlinha 3\nlinha 4')
  })

  it('escapa HTML do texto (nada vira tag)', () => {
    const html = textoParaHtml('<img src=x onerror=alert(1)> & "aspas"')
    expect(html).not.toContain('<img')
    expect(ida('<img src=x> & "aspas"')).toBe('<img src=x> & "aspas"')
  })

  it('o que o navegador cria ao digitar (div por linha, strong, em, strike) vira a sintaxe do WhatsApp', () => {
    const div = document.createElement('div')
    div.innerHTML = 'Oi<div><strong>forte</strong> e <em>leve</em></div><div><br></div><div><strike>x</strike></div>'
    expect(htmlParaTexto(div)).toBe('Oi\n*forte* e _leve_\n\n~x~')
  })

  it('espaço nas bordas do negrito fica fora do marcador (senão o WhatsApp não formata)', () => {
    const div = document.createElement('div')
    div.innerHTML = 'a<b> forte </b>b'
    expect(htmlParaTexto(div)).toBe('a *forte* b')
  })

  it('negrito vazio some', () => {
    const div = document.createElement('div')
    div.innerHTML = 'a<b> </b>b'
    expect(htmlParaTexto(div)).toBe('a b')
  })
})

describe('EditorMensagem', () => {
  it('mostra a mensagem com marcação visual e avisa a mudança no formato do WhatsApp', () => {
    const onChange = vi.fn()
    render(<EditorMensagem valor="Oi {nome}" onChange={onChange} rotulo="Copy" testId="ed" />)
    const caixa = screen.getByTestId('ed')
    expect(caixa.querySelector('[data-var="{nome}"]')).not.toBeNull()
    caixa.innerHTML = 'Oi <b>gente</b>'
    fireEvent.input(caixa)
    expect(onChange).toHaveBeenLastCalledWith('Oi *gente*')
  })

  it('só mostra {ultimo_item} quando permitido (Recuperação)', () => {
    const { rerender } = render(<EditorMensagem valor="" onChange={vi.fn()} rotulo="Copy" testId="ed" />)
    expect(screen.queryByRole('button', { name: /Último item/ })).toBeNull()
    rerender(<EditorMensagem valor="" onChange={vi.fn()} rotulo="Copy" testId="ed" ultimoItem />)
    expect(screen.getByRole('button', { name: /Último item/ })).toBeInTheDocument()
  })
})
