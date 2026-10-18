import { and, asc, eq, inArray, isNotNull, or } from 'drizzle-orm'
import { createDb, type Db } from '../db/client'
import { branches, customers, notificationJobs, orderItems, orders, systemSettings, tenantSettings, tenants } from '../db/schema'
import { renderOrderListPdf } from './order-pdf'
import { decryptSecret } from './secret-crypto'
import type { Env } from '../types'

const MALAYSIA_OFFSET_MS = 8 * 60 * 60 * 1000

export class TelegramError extends Error {
  constructor(public readonly code: 'telegram_not_configured' | 'telegram_unreachable' | 'telegram_rejected') {
    super(code)
  }
}

async function getTelegramCredentials(env: Env, db: Db) {
  const [saved] = await db.select({ value: systemSettings.value }).from(systemSettings).where(eq(systemSettings.key, 'telegram')).limit(1)
  if (saved) {
    if (!env.TELEGRAM_SETTINGS_ENCRYPTION_KEY) throw new TelegramError('telegram_not_configured')
    try {
      const config = JSON.parse(await decryptSecret(saved.value, env.TELEGRAM_SETTINGS_ENCRYPTION_KEY)) as { botToken?: string; chatId?: string }
      if (config.botToken && config.chatId) return { botToken: config.botToken, chatId: config.chatId }
    } catch {
      throw new TelegramError('telegram_not_configured')
    }
    throw new TelegramError('telegram_not_configured')
  }
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) throw new TelegramError('telegram_not_configured')
  return { botToken: env.TELEGRAM_BOT_TOKEN, chatId: env.TELEGRAM_CHAT_ID }
}

export async function sendTelegramTestMessage(env: Env, db: Db) {
  const credentials = await getTelegramCredentials(env, db)
  let response: Response
  try {
    response = await fetch(`https://api.telegram.org/bot${credentials.botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: credentials.chatId, text: 'Telegram connection test successful.' }),
    })
  } catch {
    throw new TelegramError('telegram_unreachable')
  }
  const rawBody = await response.text().catch(() => '')
  const payload = (() => { try { return JSON.parse(rawBody) as { ok?: boolean } } catch { return null } })()
  if (!response.ok || payload?.ok === false) throw new TelegramError('telegram_rejected')
}

async function sendDocument(input: { pdf: Uint8Array; filename: string; botToken: string; chatId: string }) {
  const body = new FormData()
  body.set('chat_id', input.chatId)
  body.set('document', new File([input.pdf], input.filename, { type: 'application/pdf' }))
  let response: Response
  try {
    response = await fetch(`https://api.telegram.org/bot${input.botToken}/sendDocument`, { method: 'POST', body })
  } catch {
    throw new TelegramError('telegram_unreachable')
  }
  const rawBody = await response.text().catch(() => '')
  const payload = (() => { try { return JSON.parse(rawBody) as { ok?: boolean } } catch { return null } })()
  if (!response.ok || payload?.ok === false) throw new TelegramError('telegram_rejected')
}

function malaysiaDateParts(now = new Date()) {
  const local = new Date(now.getTime() + MALAYSIA_OFFSET_MS)
  const year = local.getUTCFullYear()
  const month = local.getUTCMonth()
  const day = local.getUTCDate()
  return {
    date: `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
    time: `${String(local.getUTCHours()).padStart(2, '0')}:${String(local.getUTCMinutes()).padStart(2, '0')}`,
    start: new Date(Date.UTC(year, month, day) - MALAYSIA_OFFSET_MS),
    end: new Date(Date.UTC(year, month, day + 1) - MALAYSIA_OFFSET_MS),
  }
}

function isDue(sendTime: string | null, currentTime: string) {
  return Boolean(sendTime && /^([01]\d|2[0-3]):[0-5]\d$/.test(sendTime) && sendTime <= currentTime)
}

async function sendTenantOrderList(env: Env, db: Db, setting: { tenantId: string; organizationName: string; sendTime: string | null; lastSentDate: string | null }, now: Date, force = false) {
  const parts = malaysiaDateParts(now)
  if (!force && (!isDue(setting.sendTime, parts.time) || setting.lastSentDate === parts.date)) return 0
  const rows = await db.select({ id: orders.id, orderNumber: orders.orderNumber, createdAt: orders.createdAt, customerName: customers.name, customerPhone: customers.phone, remark: orders.remark, totalSen: orders.totalSen, branchName: branches.name }).from(orders).innerJoin(customers, and(eq(customers.id, orders.customerId), eq(customers.tenantId, setting.tenantId))).leftJoin(branches, and(eq(branches.id, orders.branchId), eq(branches.tenantId, setting.tenantId))).innerJoin(notificationJobs, and(eq(notificationJobs.orderId, orders.id), eq(notificationJobs.tenantId, setting.tenantId))).where(and(eq(orders.tenantId, setting.tenantId), or(eq(notificationJobs.status, 'pending'), eq(notificationJobs.status, 'retry_scheduled')))).orderBy(asc(orders.createdAt))
  if (rows.length === 0) {
    if (!force) await db.update(tenantSettings).set({ orderListLastSentDate: parts.date, updatedAt: new Date() }).where(eq(tenantSettings.tenantId, setting.tenantId))
    return 0
  }
  const orderIds = rows.map((row) => row.id)
  const items = await db.select({ orderId: orderItems.orderId, productNameSnapshot: orderItems.productNameSnapshot, quantity: orderItems.quantity }).from(orderItems).where(and(eq(orderItems.tenantId, setting.tenantId), inArray(orderItems.orderId, orderIds))).orderBy(asc(orderItems.id))
  const itemsByOrder = new Map<string, Array<{ productNameSnapshot: string; quantity: number }>>()
  for (const item of items) itemsByOrder.set(item.orderId, [...(itemsByOrder.get(item.orderId) ?? []), item])
  const pdf = await renderOrderListPdf({ organizationName: setting.organizationName, businessDate: parts.date, orders: rows.map((row) => ({ ...row, items: itemsByOrder.get(row.id) ?? [] })) })
  const telegram = await getTelegramCredentials(env, db)
  await sendDocument({ ...telegram, pdf, filename: `order-list-${parts.date}.pdf` })
  const jobsUpdate = db.update(notificationJobs).set({ status: 'sent', lastAttemptAt: new Date(), nextRetryAt: null, errorCategory: null }).where(and(eq(notificationJobs.tenantId, setting.tenantId), inArray(notificationJobs.orderId, orderIds), or(eq(notificationJobs.status, 'pending'), eq(notificationJobs.status, 'retry_scheduled'))))
  if (force) {
    await db.batch([jobsUpdate])
  } else {
    await db.batch([
      db.update(tenantSettings).set({ orderListLastSentDate: parts.date, updatedAt: new Date() }).where(eq(tenantSettings.tenantId, setting.tenantId)),
      jobsUpdate,
    ])
  }
  return rows.length
}

export async function sendOrderListNow(env: Env, tenantId: string) {
  const db = createDb(env)
  const [[tenant], [settings]] = await Promise.all([
    db.select({ name: tenants.name }).from(tenants).where(eq(tenants.id, tenantId)).limit(1),
    db.select({ orderListSendTime: tenantSettings.orderListSendTime, orderListLastSentDate: tenantSettings.orderListLastSentDate }).from(tenantSettings).where(eq(tenantSettings.tenantId, tenantId)).limit(1),
  ])
  if (!tenant) return null
  const orderCount = await sendTenantOrderList(env, db, {
    tenantId,
    organizationName: tenant.name,
    sendTime: settings?.orderListSendTime ?? null,
    lastSentDate: settings?.orderListLastSentDate ?? null,
  }, new Date(), true)
  return orderCount
}

export async function processDueNotifications(env: Env, limit = 10) {
  const db = createDb(env)
  const settings = await db.select({ tenantId: tenantSettings.tenantId, sendTime: tenantSettings.orderListSendTime, lastSentDate: tenantSettings.orderListLastSentDate, organizationName: tenants.name }).from(tenantSettings).innerJoin(tenants, eq(tenants.id, tenantSettings.tenantId)).where(isNotNull(tenantSettings.orderListSendTime)).limit(limit)
  for (const setting of settings) {
    try { await sendTenantOrderList(env, db, { tenantId: setting.tenantId, organizationName: setting.organizationName, sendTime: setting.sendTime, lastSentDate: setting.lastSentDate }, new Date()) } catch (error) { console.error(error) }
  }
}
