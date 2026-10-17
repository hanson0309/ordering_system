export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024

const QR_TYPES = new Map([
  ['image/png', 'png'],
  ['image/jpeg', 'jpg'],
  ['image/webp', 'webp'],
])

const RECEIPT_TYPES = new Map([
  ...QR_TYPES,
  ['application/pdf', 'pdf'],
])

export type UploadValidation = { contentType: string; extension: string; bytes: ArrayBuffer }

export async function validateUpload(file: File, allowed: 'qr' | 'receipt'): Promise<UploadValidation | 'too_large' | null> {
  const extension = (allowed === 'qr' ? QR_TYPES : RECEIPT_TYPES).get(file.type)
  if (!extension) return null
  const bytes = await file.arrayBuffer()
  if (bytes.byteLength > MAX_UPLOAD_BYTES) return 'too_large'
  return { contentType: file.type, extension, bytes }
}

export function uploadErrorResponse(result: UploadValidation | 'too_large' | null) {
  if (result === 'too_large') return { error: 'file_too_large' as const, status: 413 }
  if (!result) return { error: 'invalid_file' as const, status: 400 }
  return null
}
