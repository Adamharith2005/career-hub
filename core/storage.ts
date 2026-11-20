import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { slugify } from './domain.ts'

export const sha256 = (data: Buffer | string) => crypto.createHash('sha256').update(data).digest('hex')
export const sha256File = (f: string) => sha256(fs.readFileSync(f))

export function profileDir(root: string, p: { name: string; profile_id: string }) {
  return path.join(root, 'Profiles', `${slugify(p.name, 30)}__${p.profile_id}`)
}
export function applicationDir(root: string, p: { name: string; profile_id: string }, a: { company_name: string; role_title: string; application_id: string }) {
  return path.join(profileDir(root, p), 'Applications', `${slugify(a.company_name, 28)}__${slugify(a.role_title, 28)}__${a.application_id}`)
}

/** Resolve `target` and make sure it is inside `root` (also defeats symlink escapes for existing parents). */
export function assertInside(root: string, target: string): string {
  const r = path.resolve(root)
  const t = path.resolve(target)
  if (t !== r && !t.startsWith(r + path.sep)) throw new Error(`Refusing to write outside the Career Hub folder: ${target}`)
  let probe = t
  while (!fs.existsSync(probe) && probe !== path.dirname(probe)) probe = path.dirname(probe)
  if (fs.existsSync(probe) && fs.existsSync(r)) {
    const real = fs.realpathSync(probe), realRoot = fs.realpathSync(r)
    if (real !== realRoot && !real.startsWith(realRoot + path.sep)) throw new Error('Path escapes the Career Hub folder via a link.')
  }
  return t
}

export function ensureDir(root: string, dir: string) {
  const d = assertInside(root, dir)
  fs.mkdirSync(d, { recursive: true })
  return d
}

/** Atomic, never-overwrite write. Returns metadata verified by reading the file back. */
export function writeNewFile(root: string, file: string, data: Buffer | string) {
  const f = assertInside(root, file)
  ensureDir(root, path.dirname(f))
  if (fs.existsSync(f)) throw new Error(`File already exists (versions are immutable): ${path.basename(f)}`)
  const tmp = `${f}.${crypto.randomBytes(4).toString('hex')}.tmp`
  fs.writeFileSync(tmp, data)
  fs.renameSync(tmp, f)
  const buf = fs.readFileSync(f)
  const expected = typeof data === 'string' ? Buffer.byteLength(data) : data.length
  if (buf.length !== expected) throw new Error(`Verification failed for ${path.basename(f)}: size mismatch`)
  return { path: f, sha256: sha256(buf), size: buf.length }
}

/** Overwritable atomic write for working files such as fact-bank.json / notes.md. */
export function writeFileAtomic(root: string, file: string, data: Buffer | string) {
  const f = assertInside(root, file)
  ensureDir(root, path.dirname(f))
  const tmp = `${f}.${crypto.randomBytes(4).toString('hex')}.tmp`
  fs.writeFileSync(tmp, data)
  fs.renameSync(tmp, f)
  return f
}

export type FileState = 'ok' | 'missing' | 'changed'
export function checkFile(file: string | null | undefined, sha?: string | null): FileState {
  if (!file || !fs.existsSync(file)) return 'missing'
  if (sha && sha256File(file) !== sha) return 'changed'
  return 'ok'
}

export function copyIfMissing(src: string, dest: string) {
  if (fs.existsSync(dest)) return dest
  fs.mkdirSync(path.dirname(dest), { recursive: true })
  fs.copyFileSync(src, dest)
  return dest
}
