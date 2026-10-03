/**
 * Categoria do navegador e do sistema a partir do user-agent (rastreio da vitrine, 0138).
 * Guarda só a categoria — nunca o user-agent inteiro.
 */
export function categoriaNavegador(ua: string | null | undefined): { navegador: string; sistema: string } {
  const u = ua ?? ''
  const navegador =
    /Instagram/i.test(u) ? 'instagram'
      : /FBAN|FBAV|FB_IAB|FBIOS|\[FB/i.test(u) ? 'facebook'
        : /WhatsApp/i.test(u) ? 'whatsapp'
          : /SamsungBrowser/i.test(u) ? 'samsung'
            : /Edg\//i.test(u) ? 'edge'
              : /OPR\/|Opera/i.test(u) ? 'opera'
                : /Firefox|FxiOS/i.test(u) ? 'firefox'
                  : /CriOS|Chrome\//i.test(u) ? 'chrome'
                    : /Safari\//i.test(u) ? 'safari'
                      : 'outro'
  const sistema =
    /Android/i.test(u) ? 'android'
      : /iPhone|iPad|iPod/i.test(u) ? 'ios'
        : /Windows/i.test(u) ? 'windows'
          : /Mac OS X|Macintosh/i.test(u) ? 'mac'
            : /Linux/i.test(u) ? 'linux'
              : 'outro'
  return { navegador, sistema }
}

/** Robôs, pré-visualizações de link e ferramentas — não contam como visita. */
export function ehRobo(ua: string | null | undefined): boolean {
  const u = ua ?? ''
  if (!u.trim()) return true
  return /(bot\b|bot\/|crawl|spider|slurp|preview|facebookexternalhit|facebookcatalog|meta-externalagent|whatsapp\/\d|telegrambot|slackbot|discordbot|skypeuripreview|curl|wget|python|node-fetch|axios|go-http|headlesschrome|phantomjs|lighthouse|pagespeed|gtmetrix|pingdom|uptime)/i.test(u)
}
