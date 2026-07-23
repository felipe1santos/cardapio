import { describe, it, expect } from 'vitest'
import { composeEndereco } from './endereco'

describe('composeEndereco', () => {
  it('compõe endereço completo com todos os campos', () => {
    const texto = composeEndereco({
      rua: 'Rua das Flores',
      numero: '123',
      complemento: 'Sala 2',
      bairro: 'Centro',
      cidade: 'Fortaleza',
      estado: 'CE',
    })
    expect(texto).toBe('Rua das Flores, 123 - Sala 2, Centro, Fortaleza - CE')
  })

  it('omite complemento vazio sem deixar traço sobrando', () => {
    const texto = composeEndereco({
      rua: 'Rua das Flores',
      numero: '123',
      complemento: '',
      bairro: 'Centro',
      cidade: 'Fortaleza',
      estado: 'CE',
    })
    expect(texto).toBe('Rua das Flores, 123, Centro, Fortaleza - CE')
  })

  it('omite estado vazio sem deixar traço sobrando', () => {
    const texto = composeEndereco({
      rua: 'Rua das Flores',
      numero: '123',
      complemento: '',
      bairro: 'Centro',
      cidade: 'Fortaleza',
      estado: '',
    })
    expect(texto).toBe('Rua das Flores, 123, Centro, Fortaleza')
  })

  it('retorna string vazia quando todos os campos estão vazios', () => {
    const texto = composeEndereco({ rua: '', numero: '', complemento: '', bairro: '', cidade: '', estado: '' })
    expect(texto).toBe('')
  })

  it('ignora espaços em branco nas pontas de cada campo', () => {
    const texto = composeEndereco({ rua: '  Rua X ', numero: ' 10 ', complemento: '', bairro: '', cidade: ' Fortaleza ', estado: '' })
    expect(texto).toBe('Rua X, 10, Fortaleza')
  })
})
