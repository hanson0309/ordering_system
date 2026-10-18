import { copyFile, mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const dashboardOutput = path.join(projectRoot, 'dist', 'dashboard')
const loginOutput = path.join(dashboardOutput, 'login')

await mkdir(loginOutput, { recursive: true })
await copyFile(path.join(dashboardOutput, 'index.html'), path.join(loginOutput, 'index.html'))
