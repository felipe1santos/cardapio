import config from './tailwind.config'

describe('Menuzia Tailwind theme tokens', () => {
  const colors = (config.theme?.extend?.colors ?? {}) as Record<string, any>

  it('defines the core palette from the Menuzia prototypes', () => {
    expect(colors.page).toBe('#EDEEF1')
    expect(colors['text-main']).toBe('#1F2937')
    expect(colors['text-subtle']).toBe('#6B7280')
    expect(colors.primary).toEqual({ DEFAULT: '#0688D4', dark: '#0570AE' })
    expect(colors['status-pending']).toBe('#F97316')
    expect(colors['status-preparing']).toBe('#3B82F6')
    expect(colors['status-ready']).toBe('#10B981')
    expect(colors.price).toEqual({ bg: '#DCFCE7', text: '#16A34A' })
    expect(colors.alert).toEqual({ bg: '#E0F2FE', text: '#0369A1' })
    expect(colors.danger).toBe('#EF4444')
    expect(colors.warn).toBe('#F59E0B')
  })

  it('defines the near-square Menuzia border radius', () => {
    expect(config.theme?.extend?.borderRadius?.menuzia).toBe('3px')
  })

  it('uses Inter as the sans font family', () => {
    const sans = config.theme?.extend?.fontFamily?.sans
    expect(sans?.[0]).toBe('Inter')
  })
})
