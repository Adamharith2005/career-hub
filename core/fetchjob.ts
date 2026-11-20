import dns from 'node:dns/promises'
import net from 'node:net'

export class FetchBlocked extends Error {
  constructor(public code: 'BLOCKED' | 'INVALID' | 'UNSUPPORTED' | 'NETWORK', message: string) { super(message) }
}

export function isPrivateIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number)
    return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 192 && b === 0) || a >= 224
  }
  if (net.isIPv6(ip)) {
    const l = ip.toLowerCase()
    if (l === '::1' || l === '::' || l.startsWith('fc') || l.startsWith('fd') || l.startsWith('fe8') || l.startsWith('fe9') || l.startsWith('fea') || l.startsWith('feb')) return true
    const m = l.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)
    return m ? isPrivateIp(m[1]) : false
  }
  return true
}

type Lookup = (host: string) => Promise<{ address: string }[]>
const defaultLookup: Lookup = (h) => dns.lookup(h, { all: true })

export async function assertPublicUrl(raw: string, lookup: Lookup = defaultLookup): Promise<URL> {
  let u: URL
  try { u = new URL(raw.trim()) } catch { throw new FetchBlocked('INVALID', 'That does not look like a valid web address.') }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new FetchBlocked('INVALID', 'Only http(s) links can be fetched.')
  if (u.username || u.password) throw new FetchBlocked('INVALID', 'Links with embedded credentials are not allowed.')
  const host = u.hostname.replace(/^\[|\]$/g, '')
  if (/^localhost$|\.local$|\.internal$|\.localdomain$/i.test(host)) throw new FetchBlocked('BLOCKED', 'Local addresses cannot be fetched.')
  const addrs = net.isIP(host) ? [{ address: host }] : await lookup(host).catch(() => { throw new FetchBlocked('NETWORK', `Could not resolve ${host}.`) })
  if (!addrs.length || addrs.some((a) => isPrivateIp(a.address))) throw new FetchBlocked('BLOCKED', 'That address points to a private or local network, so it will not be fetched.')
  return u
}

export function htmlToText(html: string): string {
  return html.replace(/<(script|style|noscript|svg|head)[\s\S]*?<\/\1>/gi, ' ').replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|li|h[1-6]|tr|section|article|ul|ol)>/gi, '\n')
    .replace(/<li[^>]*>/gi, '• ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/[ \t]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim()
}

/** Fetches ONE public page. Honest and polite: no login bypass, no CAPTCHA handling, no JS rendering, size/time limits, SSRF guards on every hop. */
export async function fetchJobPage(raw: string, opts: { fetchImpl?: typeof fetch; lookup?: Lookup } = {}): Promise<{ text: string; finalUrl: string }> {
  const f = opts.fetchImpl ?? fetch
  let u = await assertPublicUrl(raw, opts.lookup)
  for (let hop = 0; hop < 4; hop++) {
    let res: Response
    try {
      res = await f(u.toString(), { redirect: 'manual', signal: AbortSignal.timeout(10000), headers: { 'user-agent': 'CareerHub/0.1 (personal job-application tool; single page fetch)', accept: 'text/html,text/plain;q=0.9' } })
    } catch { throw new FetchBlocked('NETWORK', 'Could not reach that page. Check the link or your connection, or paste the job text instead.') }
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location')
      if (!loc) throw new FetchBlocked('BLOCKED', 'The page redirected without a destination.')
      u = await assertPublicUrl(new URL(loc, u).toString(), opts.lookup)
      continue
    }
    if ([401, 403, 407, 429, 451, 999].includes(res.status)) throw new FetchBlocked('BLOCKED', 'This site does not allow automated access (login or anti-bot protection). Paste the job text instead.')
    if (!res.ok) throw new FetchBlocked('NETWORK', `The page returned HTTP ${res.status}. Paste the job text instead.`)
    const ct = res.headers.get('content-type') ?? ''
    if (!/text\/html|text\/plain|application\/xhtml/i.test(ct)) throw new FetchBlocked('UNSUPPORTED', 'That link is not a web page (PDF or other file). Paste the job text instead.')
    const buf = Buffer.from(await res.arrayBuffer()).subarray(0, 1_500_000)
    const text = /html/i.test(ct) ? htmlToText(buf.toString('utf8')) : buf.toString('utf8')
    if (text.length < 300 || (text.length < 1500 && /(sign in|log in|captcha|verify you are human|enable javascript|access denied)/i.test(text)))
      throw new FetchBlocked('BLOCKED', 'The page needs a login, JavaScript or a CAPTCHA, so no job text could be read. Paste the job text instead.')
    return { text, finalUrl: u.toString() }
  }
  throw new FetchBlocked('BLOCKED', 'Too many redirects.')
}
