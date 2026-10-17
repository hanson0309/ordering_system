const MAX_DIMENSION = 900
const MAX_DATA_URL_LENGTH = 2_000_000

export function compressImage(file: File): Promise<string> {
  if (!file.type.startsWith('image/')) return Promise.reject(new Error('invalid_image'))
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file)
    const image = new Image()
    image.onload = () => {
      URL.revokeObjectURL(objectUrl)
      const scale = Math.min(1, MAX_DIMENSION / Math.max(image.naturalWidth, image.naturalHeight))
      const canvas = document.createElement('canvas')
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale))
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale))
      const context = canvas.getContext('2d')
      if (!context) { reject(new Error('canvas_unavailable')); return }
      context.drawImage(image, 0, 0, canvas.width, canvas.height)
      let quality = 0.8
      let dataUrl = canvas.toDataURL('image/jpeg', quality)
      while (dataUrl.length > MAX_DATA_URL_LENGTH && quality > 0.45) {
        quality -= 0.08
        dataUrl = canvas.toDataURL('image/jpeg', quality)
      }
      if (dataUrl.length > MAX_DATA_URL_LENGTH) { reject(new Error('image_too_large')); return }
      resolve(dataUrl)
    }
    image.onerror = () => { URL.revokeObjectURL(objectUrl); reject(new Error('invalid_image')) }
    image.src = objectUrl
  })
}
