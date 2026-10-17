import { sql } from 'drizzle-orm'
import {
  sqliteTable,
  text,
  integer,
  uniqueIndex,
  index,
} from 'drizzle-orm/sqlite-core'

// ---------------------------------------------------------------------------
// Identity and organization
// ---------------------------------------------------------------------------

export const tenants = sqliteTable('tenants', {
  id: text('id').primaryKey(),
  slug: text('slug').notNull(),
  name: text('name').notNull(),
  status: text('status', { enum: ['active', 'suspended'] })
    .notNull()
    .default('active'),
  createdAt: integer('created_at', { mode: 'timestamp' })
    .notNull()
    .default(sql`(unixepoch())`),
}, (table) => [
  uniqueIndex('tenants_slug_unique').on(table.slug),
])

export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  email: text('email').notNull(),
  passwordHash: text('password_hash').notNull(),
  // Platform-level cross-tenant permission. Never implied by any
  // tenant-scoped role; must be explicitly granted out of band.
  isPlatformAdmin: integer('is_platform_admin', { mode: 'boolean' })
    .notNull()
    .default(false),
  createdAt: integer('created_at', { mode: 'timestamp' })
    .notNull()
    .default(sql`(unixepoch())`),
}, (table) => [
  uniqueIndex('users_email_unique').on(table.email),
])

export const memberships = sqliteTable('memberships', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id),
  tenantId: text('tenant_id')
    .notNull()
    .references(() => tenants.id),
  role: text('role', { enum: ['owner', 'admin', 'staff', 'viewer'] }).notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' })
    .notNull()
    .default(sql`(unixepoch())`),
}, (table) => [
  uniqueIndex('memberships_user_tenant_unique').on(table.userId, table.tenantId),
  index('memberships_tenant_idx').on(table.tenantId),
])

export const branches = sqliteTable('branches', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id')
    .notNull()
    .references(() => tenants.id),
  name: text('name').notNull(),
  slug: text('slug'),
  address: text('address'),
  paymentQrKey: text('payment_qr_key'),
  isDefault: integer('is_default', { mode: 'boolean' }).notNull().default(false),
  createdAt: integer('created_at', { mode: 'timestamp' })
    .notNull()
    .default(sql`(unixepoch())`),
}, (table) => [
  index('branches_tenant_idx').on(table.tenantId),
  uniqueIndex('branches_tenant_slug_unique').on(table.tenantId, table.slug),
])

export const tenantSettings = sqliteTable('tenant_settings', {
  tenantId: text('tenant_id')
    .primaryKey()
    .references(() => tenants.id),
  businessInfo: text('business_info', { mode: 'json' }),
  paymentQrKey: text('payment_qr_key'),
  orderListSendTime: text('order_list_send_time'),
  orderListLastSentDate: text('order_list_last_sent_date'),
  updatedAt: integer('updated_at', { mode: 'timestamp' })
    .notNull()
    .default(sql`(unixepoch())`),
})

// Server-side sessions. The cookie only ever carries an opaque random token;
// the DB stores a hash of it plus the currently authorized tenant context.
// activeTenantId is set only after a membership check (login / org switch)
// and is what every request's tenant resolver reads — never a client input.
export const sessions = sqliteTable('sessions', {
  id: text('id').primaryKey(),
  tokenHash: text('token_hash').notNull(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id),
  activeTenantId: text('active_tenant_id').references(() => tenants.id),
  createdAt: integer('created_at', { mode: 'timestamp' })
    .notNull()
    .default(sql`(unixepoch())`),
  expiresAt: integer('expires_at', { mode: 'timestamp' }).notNull(),
}, (table) => [
  uniqueIndex('sessions_token_hash_unique').on(table.tokenHash),
  index('sessions_user_idx').on(table.userId),
])

// ---------------------------------------------------------------------------
// Products and customers
// ---------------------------------------------------------------------------

export const categories = sqliteTable('categories', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id')
    .notNull()
    .references(() => tenants.id),
  branchId: text('branch_id').references(() => branches.id),
  name: text('name').notNull(),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: integer('created_at', { mode: 'timestamp' })
    .notNull()
    .default(sql`(unixepoch())`),
}, (table) => [
  index('categories_tenant_idx').on(table.tenantId),
  index('categories_branch_idx').on(table.tenantId, table.branchId),
])

export const products = sqliteTable('products', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id')
    .notNull()
    .references(() => tenants.id),
  branchId: text('branch_id').references(() => branches.id),
  categoryId: text('category_id').references(() => categories.id),
  name: text('name').notNull(),
  imageUrl: text('image_url'),
  // Money stored as integer sen (never floating point).
  priceSen: integer('price_sen').notNull(),
  isPublic: integer('is_public', { mode: 'boolean' }).notNull().default(true),
  isAvailable: integer('is_available', { mode: 'boolean' }).notNull().default(true),
  createdAt: integer('created_at', { mode: 'timestamp' })
    .notNull()
    .default(sql`(unixepoch())`),
}, (table) => [
  index('products_tenant_idx').on(table.tenantId),
  index('products_branch_idx').on(table.tenantId, table.branchId),
  index('products_tenant_category_idx').on(table.tenantId, table.categoryId),
])

export const productImages = sqliteTable('product_images', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id')
    .notNull()
    .references(() => tenants.id),
  productId: text('product_id')
    .notNull()
    .references(() => products.id),
  r2Key: text('r2_key').notNull(),
  sortOrder: integer('sort_order').notNull().default(0),
}, (table) => [
  index('product_images_tenant_idx').on(table.tenantId),
  index('product_images_product_idx').on(table.productId),
])

export const customers = sqliteTable('customers', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id')
    .notNull()
    .references(() => tenants.id),
  name: text('name').notNull(),
  phone: text('phone').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' })
    .notNull()
    .default(sql`(unixepoch())`),
}, (table) => [
  index('customers_tenant_idx').on(table.tenantId),
  index('customers_tenant_phone_idx').on(table.tenantId, table.phone),
])

// ---------------------------------------------------------------------------
// Orders
// ---------------------------------------------------------------------------

export const orders = sqliteTable('orders', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id')
    .notNull()
    .references(() => tenants.id),
  branchId: text('branch_id').references(() => branches.id),
  orderNumber: text('order_number').notNull(),
  status: text('status', {
    enum: ['pending', 'confirmed', 'preparing', 'completed', 'cancelled'],
  })
    .notNull()
    .default('pending'),
  customerId: text('customer_id')
    .notNull()
    .references(() => customers.id),
  remark: text('remark'),
  paymentReceiptKey: text('payment_receipt_key'),
  paymentReceiptContentType: text('payment_receipt_content_type'),
  paymentReceiptUploadedAt: integer('payment_receipt_uploaded_at', { mode: 'timestamp' }),
  totalSen: integer('total_sen').notNull(),
  // Protects against duplicate submission from the storefront (e.g. double
  // click / retry). Unique per tenant, supplied by the client at creation
  // time and ignored on retry if a matching order already exists.
  idempotencyKey: text('idempotency_key').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' })
    .notNull()
    .default(sql`(unixepoch())`),
}, (table) => [
  uniqueIndex('orders_tenant_order_number_unique').on(table.tenantId, table.orderNumber),
  uniqueIndex('orders_tenant_idempotency_unique').on(table.tenantId, table.idempotencyKey),
  index('orders_tenant_status_created_idx').on(table.tenantId, table.status, table.createdAt),
  index('orders_branch_status_created_idx').on(table.tenantId, table.branchId, table.status, table.createdAt),
])

export const orderItems = sqliteTable('order_items', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id')
    .notNull()
    .references(() => tenants.id),
  orderId: text('order_id')
    .notNull()
    .references(() => orders.id),
  // Snapshots taken at order-creation time. Later edits to the product
  // (name, price, options) must never retroactively change past orders.
  productNameSnapshot: text('product_name_snapshot').notNull(),
  unitPriceSenSnapshot: integer('unit_price_sen_snapshot').notNull(),
  quantity: integer('quantity').notNull(),
  optionsSnapshot: text('options_snapshot', { mode: 'json' }),
}, (table) => [
  index('order_items_tenant_idx').on(table.tenantId),
  index('order_items_order_idx').on(table.orderId),
])

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------

export const notificationJobs = sqliteTable('notification_jobs', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id')
    .notNull()
    .references(() => tenants.id),
  orderId: text('order_id')
    .notNull()
    .references(() => orders.id),
  status: text('status', {
    enum: ['pending', 'processing', 'sent', 'retry_scheduled', 'failed', 'cancelled'],
  })
    .notNull()
    .default('pending'),
  attemptCount: integer('attempt_count').notNull().default(0),
  lastAttemptAt: integer('last_attempt_at', { mode: 'timestamp' }),
  nextRetryAt: integer('next_retry_at', { mode: 'timestamp' }),
  errorCategory: text('error_category'),
  idempotencyKey: text('idempotency_key').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' })
    .notNull()
    .default(sql`(unixepoch())`),
}, (table) => [
  uniqueIndex('notification_jobs_tenant_idempotency_unique').on(table.tenantId, table.idempotencyKey),
  index('notification_jobs_tenant_status_idx').on(table.tenantId, table.status),
  index('notification_jobs_next_retry_idx').on(table.status, table.nextRetryAt),
])

export const notificationAttempts = sqliteTable('notification_attempts', {
  id: text('id').primaryKey(),
  jobId: text('job_id')
    .notNull()
    .references(() => notificationJobs.id),
  tenantId: text('tenant_id')
    .notNull()
    .references(() => tenants.id),
  attemptedAt: integer('attempted_at', { mode: 'timestamp' })
    .notNull()
    .default(sql`(unixepoch())`),
  result: text('result', { enum: ['success', 'failure'] }).notNull(),
  errorCategory: text('error_category'),
}, (table) => [
  index('notification_attempts_tenant_idx').on(table.tenantId),
  index('notification_attempts_job_idx').on(table.jobId),
])

// ---------------------------------------------------------------------------
// Auditing
// ---------------------------------------------------------------------------

export const auditLogs = sqliteTable('audit_logs', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id')
    .notNull()
    .references(() => tenants.id),
  userId: text('user_id').references(() => users.id),
  action: text('action').notNull(),
  targetType: text('target_type').notNull(),
  targetId: text('target_id').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' })
    .notNull()
    .default(sql`(unixepoch())`),
}, (table) => [
  index('audit_logs_tenant_created_idx').on(table.tenantId, table.createdAt),
])
