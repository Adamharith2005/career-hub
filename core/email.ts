import crypto from 'node:crypto'
import path from 'node:path'
import { findTech, roleLabel } from './domain.ts'
import type { Fact, Profile } from './profiles.ts'
import { companyAliases, winAnsi } from './render.ts'
import { eduClause, rolePhrase } from './resume.ts'

export type EmailKind = 'APPLY' | 'SPECULATIVE' | 'FOLLOW_UP' | 'THANK_YOU'
export const EMAIL_KIND_LABEL: Record<EmailKind, string> = {
  APPLY: 'Apply to advertised vacancy', SPECULATIVE: 'Speculative enquiry', FOLLOW_UP: 'Follow-up after applying', THANK_YOU: 'Interview thank-you',
}
export interface EmailDraft { kind: EmailKind; language: 'en' | 'ms'; subject: string; body: string }

export interface EmailCtx {
  kind: EmailKind; language: 'en' | 'ms'; company: string; role: string; roleFamily?: string
  careerType: 'INTERNSHIP' | 'GRADUATE'; attachmentLabels: string[]
  appliedOn?: string | null; hasResponse?: boolean; interviewTopic?: string; interviewDate?: string; requiredTech?: string[]
}

const by = (fs: Fact[], c: Fact['category']) => fs.filter((f) => f.confirmed && f.category === c)
const firstLine = (f: Fact) => f.claim_text.split('\n').map((s) => s.trim()).find((l) => l && !/^\(.*\)$/.test(l))?.replace(/[.\s]+$/, '')

export function attachmentLine(labels: string[], lang: 'en' | 'ms') {
  if (!labels.length) return ''
  const j = labels.length === 1 ? labels[0] : `${labels.slice(0, -1).join(', ')} ${lang === 'ms' ? 'dan' : 'and'} ${labels.at(-1)}`
  return lang === 'ms' ? `Lampiran: ${j}.` : `Attached: ${j}.`
}
/** Replace (or insert) the "Attached:" line when the user toggles attachments. */
export function setAttachmentLine(body: string, labels: string[], lang: 'en' | 'ms') {
  const line = attachmentLine(labels, lang)
  const re = /^(Attached|Lampiran):.*$/m
  if (re.test(body)) return line ? body.replace(re, line) : body.replace(re, '').replace(/\n{3,}/g, '\n\n')
  if (!line) return body
  const i = body.search(/\n\n(Thank you|Terima kasih|Kind regards|Yang benar)/)
  return i >= 0 ? `${body.slice(0, i)}\n\n${line}${body.slice(i)}` : `${body}\n\n${line}`
}

export function buildEmail(profile: Profile, facts: Fact[], c: EmailCtx): EmailDraft {
  const ms = c.language === 'ms'
  const id = profile.identity
  const name = id.fullName || profile.name
  const edu = by(facts, 'EDUCATION')[0]
  const uni = edu?.organization || ''
  const p = profile.prefs
  const dates = c.careerType === 'INTERNSHIP' && p.internshipStart ? `${p.internshipStart}${p.internshipEnd ? ` – ${p.internshipEnd}` : ''}` : ''
  const want = new Set(c.requiredTech ?? [])
  const work = [...by(facts, 'PROJECT'), ...by(facts, 'EXPERIENCE')].map((f) => ({ f, n: findTech([f.title, f.claim_text, f.tools.join(' ')].join(' ')).filter((t) => want.has(t)).length })).sort((a, b) => b.n - a.n)
  const skills = by(facts, 'SKILL')[0]
  const sig = [name, [id.phone, id.email].filter(Boolean).join(' | '), id.github ?? id.linkedin].filter(Boolean).join('\n')
  const kindWord = c.careerType === 'INTERNSHIP' ? (ms ? 'latihan industri' : 'internship') : (ms ? 'jawatan' : 'position')
  const who = edu ? eduClause(edu, c.language) : ''
  const att = attachmentLine(c.attachmentLabels, c.language)
  const subjUni = uni ? `, ${uni}` : ''

  const points: string[] = []
  work.slice(0, 2).forEach(({ f }) => { const l = firstLine(f); points.push(`- ${f.title}${f.tools.length ? ` (${f.tools.slice(0, 4).join(', ')})` : ''}${l ? `: ${l}` : ''}`) })
  if (skills && skills.tools.length) points.push(`- ${ms ? 'Kemahiran utama' : 'Core skills'}: ${skills.tools.slice(0, 8).join(', ')}`)
  const pointsBlock = points.length ? `${ms ? 'Beberapa perkara yang berkaitan:' : 'A few relevant points:'}\n${points.join('\n')}` : ''

  let subject = '', body = ''
  if (c.kind === 'APPLY') {
    subject = c.careerType === 'INTERNSHIP' ? `Internship Application: ${c.role}${dates ? ` (${dates})` : ''} - ${name}${subjUni}` : `Application: ${c.role} - ${name}${subjUni}`
    if (ms) subject = `Permohonan ${kindWord}: ${c.role}${dates ? ` (${dates})` : ''} - ${name}${subjUni}`
    body = ms
      ? [`Tuan/Puan,`, `Saya ingin memohon ${rolePhrase(c.role, c.careerType, 'ms')} di ${c.company}.${who ? ` Saya ${who}${dates ? ` dan tersedia ${dates}` : ''}.` : ''}`, pointsBlock, att, `Terima kasih atas masa dan pertimbangan tuan/puan.`, `Yang benar,\n${sig}`].filter(Boolean).join('\n\n')
      : [`Dear Hiring Team,`, `I am applying for the ${rolePhrase(c.role, c.careerType, 'en')} at ${c.company}.${who ? ` I am ${who}${dates ? `, available ${dates}` : ''}.` : ''}`, pointsBlock, att, `Thank you for your time and consideration.`, `Kind regards,\n${sig}`].filter(Boolean).join('\n\n')
  } else if (c.kind === 'SPECULATIVE') {
    const area = c.roleFamily && c.roleFamily !== 'other' ? roleLabel(c.roleFamily) : c.role
    subject = ms ? `Pertanyaan ${kindWord}: ${area}${dates ? ` (${dates})` : ''} - ${name}${subjUni}` : `${c.careerType === 'INTERNSHIP' ? 'Internship' : 'Opportunity'} Enquiry: ${area}${dates ? ` (${dates})` : ''} - ${name}${subjUni}`
    body = ms
      ? [`Tuan/Puan,`, `Saya ingin bertanya sama ada ${c.company} menerima pelajar untuk ${kindWord} dalam bidang ${area}. Saya tahu tiada iklan jawatan ketika ini, jadi ini hanyalah pertanyaan.${who ? ` Saya ${who}${dates ? ` dan tersedia ${dates}` : ''}.` : ''}`, pointsBlock, att, `Jika sesuai, saya berbesar hati untuk berbincang ringkas atau menghantar maklumat tambahan. Terima kasih.`, `Yang benar,\n${sig}`].filter(Boolean).join('\n\n')
      : [`Dear Hiring Team,`, `I am writing to ask whether ${c.company} takes ${c.careerType === 'INTERNSHIP' ? 'interns' : 'graduates'} in ${area}. I understand there may be no advertised opening, so this is an enquiry rather than an application.${who ? ` I am ${who}${dates ? `, available ${dates}` : ''}.` : ''}`, pointsBlock, att, `If it is useful, I would be glad to share more or have a short conversation. Thank you for your time.`, `Kind regards,\n${sig}`].filter(Boolean).join('\n\n')
  } else if (c.kind === 'FOLLOW_UP') {
    subject = ms ? `Susulan: Permohonan ${c.role} - ${name}` : `Following up: ${c.role} application - ${name}`
    const first = c.hasResponse
      ? (ms ? `Terima kasih atas maklum balas tuan/puan mengenai jawatan ${c.role}. Saya ingin bertanya mengenai langkah seterusnya.` : `Thank you for your earlier reply about the ${rolePhrase(c.role, c.careerType, 'en')}. I wanted to ask about the next steps and timeline.`)
      : (ms ? `Saya memohon jawatan ${c.role}${c.appliedOn ? ` pada ${c.appliedOn}` : ''} dan ingin bertanya sama ada permohonan saya telah diterima dan jika ada maklumat lanjut yang diperlukan.` : `I applied for the ${rolePhrase(c.role, c.careerType, 'en')}${c.appliedOn ? ` on ${c.appliedOn}` : ''} and wanted to check that my application was received, and whether you need anything further from me.`)
    body = ms ? [`Tuan/Puan,`, first, `Saya masih berminat dengan peluang ini. Terima kasih.`, `Yang benar,\n${sig}`].join('\n\n') : [`Dear Hiring Team,`, first, `I remain very interested in the opportunity. Thank you for your time.`, `Kind regards,\n${sig}`].join('\n\n')
  } else {
    subject = ms ? `Terima kasih - temu duga ${c.role} - ${name}` : `Thank you - ${c.role} interview - ${name}`
    const topic = c.interviewTopic?.trim()
    body = ms
      ? [`Tuan/Puan,`, `Terima kasih kerana meluangkan masa${c.interviewDate ? ` pada ${c.interviewDate}` : ''} untuk berbincang mengenai jawatan ${c.role} di ${c.company}.${topic ? ` Saya amat menghargai perbincangan mengenai ${topic}.` : ''}`, `Saya masih berminat dengan peluang ini dan sedia memberikan maklumat tambahan.`, `Yang benar,\n${sig}`].join('\n\n')
      : [`Dear Hiring Team,`, `Thank you for taking the time${c.interviewDate ? ` on ${c.interviewDate}` : ''} to speak with me about the ${rolePhrase(c.role, c.careerType, 'en')} at ${c.company}.${topic ? ` I enjoyed our discussion about ${topic}.` : ''}`, `I remain interested in the role and am happy to provide anything further.`, `Kind regards,\n${sig}`].join('\n\n')
  }
  return { kind: c.kind, language: c.language, subject: subject.replace(/\s+/g, ' ').trim(), body }
}

// ------------------------------------------------------------------ lint
export interface LintIssue { severity: 'error' | 'warn'; message: string }
const FREE = /@(gmail|yahoo|hotmail|outlook|live|icloud)\./i

export function lintEmail(a: {
  to: string; subject: string; body: string; profile: Profile; company: string; allCompanyNames: string[]
  attachments: { name: string; exists: boolean }[]; companyWebsite?: string | null; ownText?: string
}): LintIssue[] {
  const out: LintIssue[] = []
  const text = `${a.subject}\n${a.body}`
  if (!a.subject.trim()) out.push({ severity: 'error', message: 'The subject is empty.' })
  if (/\{\{|\}\}|\[(company|name|role|date|your)[^\]]*\]|\bTODO\b|<[A-Z ]{3,}>/i.test(text)) out.push({ severity: 'error', message: 'A placeholder is still in the text.' })
  const name = a.profile.identity.fullName || a.profile.name
  if (!text.toLowerCase().includes(name.split(' ')[0].toLowerCase())) out.push({ severity: 'warn', message: 'Your name does not appear in the email.' })
  if (a.company && !text.toLowerCase().includes(a.company.split(/[\s(]/)[0].toLowerCase())) out.push({ severity: 'warn', message: `The email does not mention ${a.company}.` })
  const own = (a.ownText ?? '').toLowerCase()
  const tgt = new Set(companyAliases(a.company).map((x) => x.toLowerCase()))
  const leaks = new Set<string>()
  for (const n of a.allCompanyNames) for (const al of companyAliases(n)) {
    const l = al.toLowerCase()
    if (tgt.has(l) || a.company.toLowerCase().includes(l) || own.includes(l) || l.length < 5) continue
    if (new RegExp(`(?<![a-z0-9])${l.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![a-z0-9])`, 'i').test(text)) leaks.add(al)
  }
  if (leaks.size) out.push({ severity: 'error', message: `Mentions another company: ${[...leaks].join(', ')}.` })
  if (a.to) {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(a.to)) out.push({ severity: 'error', message: 'The recipient address is not valid.' })
    else {
      if (FREE.test(a.to)) out.push({ severity: 'warn', message: 'The recipient uses a free-mail domain. Make sure it really belongs to the employer.' })
      const dom = a.companyWebsite?.replace(/^https?:\/\/(www\.)?/i, '').split('/')[0]
      if (dom && !a.to.toLowerCase().split('@')[1].endsWith(dom.split('.').slice(-3).join('.').replace(/^com\.my$/, 'com.my')) && !a.to.toLowerCase().includes(dom.split('.')[0]))
        out.push({ severity: 'warn', message: `The recipient domain does not match the company website (${dom}). Verify it.` })
    }
  }
  for (const f of a.attachments) if (!f.exists) out.push({ severity: 'error', message: `Attachment "${f.name}" is missing on disk. Regenerate it.` })
  if (/\bI am (so |very )?excited\b|\bpassionate\b|\bhard-?working\b/i.test(a.body)) out.push({ severity: 'warn', message: 'Generic enthusiasm wording detected — consider something more specific.' })
  const words = a.body.trim().split(/\s+/).length
  if (words > 230) out.push({ severity: 'warn', message: `The email is ${words} words. Initial emails read best at 100–180.` })
  return out
}

// ------------------------------------------------------------------ MIME .eml
const MIME: Record<string, string> = { '.pdf': 'application/pdf', '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', '.txt': 'text/plain' }
const b64Lines = (buf: Buffer) => (buf.toString('base64').match(/.{1,76}/g) ?? []).join('\r\n')
function encodeHeader(v: string): string {
  if (/^[\x20-\x7E]*$/.test(v)) return v
  const words: string[] = []
  let cur = '', curBytes = 0
  for (const ch of v) {
    const b = Buffer.byteLength(ch)
    if (curBytes + b > 42) { words.push(cur); cur = ''; curBytes = 0 }
    cur += ch; curBytes += b
  }
  if (cur) words.push(cur)
  return words.map((w) => `=?UTF-8?B?${Buffer.from(w, 'utf8').toString('base64')}?=`).join('\r\n ')
}
const asciiName = (n: string) => winAnsi(n).normalize('NFKD').replace(/[^\x20-\x7E]/g, '_').replace(/["\\]/g, '_')

export interface EmlInput { from?: string; to?: string; subject: string; body: string; attachments: { filename: string; content: Buffer }[]; date?: Date }

export function buildEml(i: EmlInput): Buffer {
  const boundary = `=_careerhub_${crypto.randomBytes(12).toString('hex')}`
  const h: string[] = ['X-Unsent: 1']
  if (i.from) h.push(`From: ${i.from}`)
  h.push(`To: ${i.to ?? ''}`)
  h.push(`Subject: ${encodeHeader(i.subject)}`)
  h.push(`Date: ${(i.date ?? new Date()).toUTCString().replace('GMT', '+0000')}`)
  h.push('MIME-Version: 1.0')
  h.push(`Content-Type: multipart/mixed; boundary="${boundary}"`)
  const parts: string[] = []
  parts.push([`--${boundary}`, 'Content-Type: text/plain; charset="utf-8"', 'Content-Transfer-Encoding: base64', '', b64Lines(Buffer.from(i.body.replace(/\r?\n/g, '\r\n'), 'utf8'))].join('\r\n'))
  for (const a of i.attachments) {
    const mime = MIME[path.extname(a.filename).toLowerCase()] ?? 'application/octet-stream'
    const n = asciiName(a.filename)
    parts.push([`--${boundary}`, `Content-Type: ${mime}; name="${n}"`, 'Content-Transfer-Encoding: base64', `Content-Disposition: attachment; filename="${n}"`, '', b64Lines(a.content)].join('\r\n'))
  }
  return Buffer.from(`${h.join('\r\n')}\r\n\r\n${parts.join('\r\n')}\r\n--${boundary}--\r\n`, 'utf8')
}
