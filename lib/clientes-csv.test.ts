import { describe, expect, it } from 'vitest'
import {
  BOM, campoDoNome, conferirArquivo, csvDeErros, dataBr, decodificar, detectarSeparador, filtrarExportacao, lerCsv,
  mapearAutomatico, mapeamentoValido, modeloCsv, nomeArquivoExportacao, pareceBinario, planilhaCompleta, temCabecalho,
} from './clientes-csv'

const latin1 = (s: string) => Uint8Array.from([...s].map((c) => c.charCodeAt(0)))

describe('leitura do CSV', () => {
  it('UTF-8 com BOM e Windows-1252 (Excel) viram o mesmo texto', () => {
    const utf8 = new TextEncoder().encode('﻿João;Açaí')
    expect(decodificar(utf8)).toEqual({ texto: 'João;Açaí', codificacao: 'UTF-8' })
    expect(decodificar(latin1('João;Açaí'))).toEqual({ texto: 'João;Açaí', codificacao: 'Windows-1252' })
  })
  it('separador', () => {
    expect(detectarSeparador('nome;telefone\nA;B')).toBe(';')
    expect(detectarSeparador('nome,telefone\nA,B')).toBe(',')
    expect(detectarSeparador('"Silva, Maria";27999998888')).toBe(';')
  })
  it('aspas, aspas dobradas, quebra dentro de aspas e linhas vazias', () => {
    expect(lerCsv('a;"b;c";"d ""x"""\r\n\r\n"l1\nl2";2\n', ';')).toEqual([['a', 'b;c', 'd "x"'], ['l1\nl2', '2']])
  })
  it('binário (xlsx) é reconhecido', () => {
    expect(pareceBinario(Uint8Array.from([0x50, 0x4b, 3, 4]))).toBe(true)
    expect(pareceBinario(new TextEncoder().encode('nome;telefone'))).toBe(false)
  })
})

describe('cabeçalho e mapeamento', () => {
  it('reconhece variações', () => {
    expect(campoDoNome('Cliente')).toBe('nome')
    expect(campoDoNome('WhatsApp')).toBe('telefone')
    expect(campoDoNome('Celular')).toBe('telefone')
    expect(campoDoNome('Fone')).toBe('telefone')
    expect(campoDoNome('E-mail')).toBe('email')
    expect(campoDoNome('Data de Nascimento')).toBe('data_nascimento')
    expect(campoDoNome('Endereço')).toBe('rua')
    expect(campoDoNome('Nº')).toBe('numero')
    expect(campoDoNome('qualquer coisa')).toBeNull()
  })
  it('cabeçalho x primeira linha de dados', () => {
    expect(temCabecalho(['Nome', 'Celular'])).toBe(true)
    expect(temCabecalho(['Maria', '27999998888'])).toBe(false)
  })
  it('mapeamento automático sem repetir campo; sem cabeçalho segue o modelo', () => {
    expect(mapearAutomatico(['Cliente', 'Nome', 'Fone', 'X'], true)).toEqual(['nome', null, 'telefone', null])
    expect(mapearAutomatico(['Maria', '27999998888'], false)).toEqual(['nome', 'telefone'])
    expect(mapeamentoValido(['nome', null])).toMatch(/Telefone/)
  })
})

describe('validação das linhas', () => {
  const mapa = ['nome', 'telefone', 'data_nascimento', 'email', 'cep', 'uf'] as const
  it('telefones em formatos variados viram 55 + DDD + número', () => {
    const r = conferirArquivo([
      ['A', '(27) 99999-8888', '', '', '', ''],
      ['B', '+55 27 98888-7777', '', '', '', ''],
      ['C', '27 3333-4444', '', '', '', ''],
      ['D', '5527977776666', '', '', '', ''],
    ], [...mapa], 2)
    expect(r.map((l) => l.dados?.telefone)).toEqual(['5527999998888', '5527988887777', '552733334444', '5527977776666'])
  })
  it('erros: nome vazio, telefone inválido, repetido no arquivo', () => {
    const r = conferirArquivo([
      ['', '27999998888', '', '', '', ''],
      ['X', '123', '', '', '', ''],
      ['Y', '27999990000', '', '', '', ''],
      ['Z', '(27) 99999-0000', '', '', '', ''],
    ], [...mapa], 2)
    expect(r[0].erros).toContain('Nome vazio')
    expect(r[1].erros[0]).toMatch(/Telefone inválido/)
    expect(r[2].dados).not.toBeNull()
    expect(r[3].erros[0]).toMatch(/repetido no arquivo \(igual à linha 4\)/)
  })
  it('avisos descartam só o campo', () => {
    const [l] = conferirArquivo([['A', '27999998888', '31/02/1990', 'x@', '123', 'Espírito']], [...mapa], 2)
    expect(l.dados).toMatchObject({ data_nascimento: null, email: null, cep: null, uf: null })
    expect(l.avisos).toHaveLength(4)
    const [ok] = conferirArquivo([['A', '27999998888', '15/03/1990', 'a@b.com', '29100000', 'es']], [...mapa], 2)
    expect(ok.dados).toMatchObject({ data_nascimento: '1990-03-15', email: 'a@b.com', cep: '29100-000', uf: 'ES' })
  })
  it('datas', () => {
    expect(dataBr('5/3/90')).toBe('1990-03-05')
    expect(dataBr('1990-03-05')).toBe('1990-03-05')
    expect(dataBr('29/02/2023')).toBeNull()
  })
})

describe('arquivos gerados', () => {
  it('modelo: BOM, ; e o cabeçalho', () => {
    const m = modeloCsv()
    expect(m.startsWith(BOM)).toBe(true)
    expect(m.split('\r\n')[0]).toBe('﻿nome;telefone;email;data_nascimento;cep;rua;numero;complemento;bairro;cidade;uf;observacoes')
    expect(m.split('\r\n')).toHaveLength(3)
  })
  it('modelo baixado e reimportado: 2 válidos', () => {
    const { texto } = decodificar(new TextEncoder().encode(modeloCsv()))
    const linhas = lerCsv(texto, detectarSeparador(texto))
    const mapa = mapearAutomatico(linhas[0], temCabecalho(linhas[0]))
    expect(conferirArquivo(linhas.slice(1), mapa, 2).filter((l) => l.dados)).toHaveLength(2)
  })
  it('linhas com erro + motivo', () => {
    const r = conferirArquivo([['', '27999998888']], ['nome', 'telefone'], 2)
    expect(csvDeErros(['nome', 'telefone'], r)).toContain('nome;telefone;linha;motivo\r\n;27999998888;2;Nome vazio')
  })
  it('planilha completa em formato brasileiro', () => {
    const csv = planilhaCompleta([{ nome: 'Ana; "A"', telefone: '5527999998888', totalPedidos: 3, ultimaCompraEm: '2026-09-10T15:00:00Z', cadastradoEm: null,
      endereco: { rua: 'Rua A', numero: '1', complemento: '', bairro: 'Centro', cep: '29100-000', cidade: 'Vila Velha' },
      valorTotal: 1234.5, ticketMedio: 411.5, pedidosPorSemana: 1.25, diaSemanaPreferido: 5, gastoSemanalMedio: 100 }])
    const l = csv.split('\r\n')[1]
    expect(l).toBe('"Ana; ""A""";5527999998888;Rua A, 1 - Centro - Vila Velha - CEP 29100-000;3;10/09/2026, 12:00;1.234,50;411,50;1,3;Sexta;100,00')
  })
})

describe('exportação', () => {
  const base = [
    { nome: 'A', telefone: '5527999998888', totalPedidos: 1, ultimaCompraEm: '2026-09-30T12:00:00Z', cadastradoEm: '2026-09-30T12:00:00Z' },
    { nome: 'B', telefone: '5527999990000', totalPedidos: 3, ultimaCompraEm: '2026-08-01T12:00:00Z', cadastradoEm: '2026-01-01T12:00:00Z' },
    { nome: 'C', telefone: 'x', totalPedidos: 0, ultimaCompraEm: null, cadastradoEm: '2026-09-29T12:00:00Z' },
  ]
  it('período pela última compra ou pelo cadastro', () => {
    expect(filtrarExportacao(base, { de: '2026-09-01', ate: '2026-09-30', base: 'compra' }).map((c) => c.nome)).toEqual(['A'])
    expect(filtrarExportacao(base, { de: '2026-09-01', ate: '2026-09-30', base: 'cadastro' }).map((c) => c.nome)).toEqual(['A', 'C'])
    expect(filtrarExportacao(base, { de: null, ate: null, base: 'compra' })).toHaveLength(3)
  })
  it('filtros', () => {
    expect(filtrarExportacao(base, { de: null, ate: null, base: 'compra', recorrentes: true }).map((c) => c.nome)).toEqual(['B'])
    expect(filtrarExportacao(base, { de: null, ate: null, base: 'compra', umaVez: true }).map((c) => c.nome)).toEqual(['A'])
    expect(filtrarExportacao(base, { de: null, ate: null, base: 'compra', comTelefone: true })).toHaveLength(2)
  })
  it('nome do arquivo', () => {
    expect(nomeArquivoExportacao('menuzia', '2026-09-01', '2026-09-30', '2026-10-01')).toBe('clientes-menuzia-2026-09-01_2026-09-30.csv')
    expect(nomeArquivoExportacao('menuzia', null, null, '2026-10-01')).toBe('clientes-menuzia-inicio_2026-10-01.csv')
  })
})
