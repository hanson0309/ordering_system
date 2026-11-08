import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'

export type Language = 'zh' | 'en'

const translations: Record<Language, Record<string, string>> = {
  zh: {
    'Online ordering': 'Online ordering',
    'Shopping cart': '购物车',
    'Welcome': '欢迎光临',
    'Pick your favorites and order directly.': '选好喜欢的，直接下单。',
    'Order online, leave your contact details, and submit. The store will contact you to confirm.': '线上点单，填写联系方式后提交。店家收到订单后会尽快联系你确认。',
    'All': '全部',
    'Add-ons': '加购品',
    'Lunch': '午餐',
    'Dinner': '晚餐',
    'Order by {time} (Malaysia time)': '请在马来西亚时间 {time} 前下单',
    'Menu is being prepared': '菜单正在准备中',
    'No products are currently available for purchase.': '店家暂时没有上架可购买的商品。',
    'Selected {count}': '已选 {count}',
    'Add to cart': '加入购物车',
    'Added to cart': '已加入购物车',
    '{count} items': '{count} 件商品',
    'View cart': '查看购物车',
    'Store not found': '找不到这家店',
    'Please check that the store link is correct.': '请确认店铺链接是否正确。',
    'Menu unavailable': '菜单暂时无法加载',
    'Please try again later.': '请稍后再试。',
    'Back to menu': '返回菜单',
    'Confirm order': '确认订单',
    'Your cart is empty': '购物车还是空的',
    'Choose products': '去选商品',
    'Order details': '订单内容',
    'per item': '/ 件',
    'Remove': '移除',
    'Total': '合计',
    'Contact details': '联系资料',
    'Order remark': '订单备注',
    'Remark placeholder': '例如：少冰、不要辣、送到前台',
    'The store will contact you by phone to confirm your order.': '店家会通过电话号码联系你确认订单。',
    'Name': '姓名',
    'Phone number': '电话号码',
    'What should we call you?': '怎么称呼你？',
    'e.g. 0123456789': '例如 0123456789',
    'Submitting...': '提交中…',
    'Submit order': '提交订单',
    'Your cart contains an unavailable product. Please return to the menu.': '购物车中有商品已下架，请返回菜单检查。',
    'A meal in your cart has closed or is no longer available. Please return to the menu.': '购物车里的餐点已截止或不再供应，请返回菜单更新订单。',
    'Please check your name and phone number.': '请检查姓名和电话号码。',
    'Order submission failed. Please try again later.': '订单提交失败，请稍后再试。',
    'Order submitted': '订单已提交',
    'Order number': '订单编号',
    'The store received your order and will contact you by phone to confirm.': '店家已经收到你的订单，会通过电话号码联系你确认。',
    'The order has been submitted. Keep the store contact details for confirmation.': '订单已经提交。请保留店家的联系方式以便确认。',
    'Continue ordering': '继续点单',
    'Pay using this QR code': '请使用这个二维码付款',
    'Seller payment QR code': '卖家收款二维码',
    'After payment, choose your receipt and it will upload automatically.': '付款后，选择付款单据即可自动上传。',
    'Choose payment receipt': '选择付款单据',
    'Uploading...': '上传中…',
    'Payment receipt uploaded': '付款单据已上传',
    'Cancel payment receipt': '取消已上传单据',
    'Cancelling...': '取消中…',
    'Payment receipt cancellation failed.': '取消付款单据失败。',
    'Payment receipt upload failed.': '付款单据上传失败。',
    'Payment receipt is too large.': '付款单据不能超过 5 MB。',
    'Choose an image or PDF receipt.': '请选择图片或 PDF 格式的付款单据。',
    'Decrease {name}': '减少 {name}',
    'Increase {name}': '增加 {name}',
    'Chinese': '中文',
    'English': 'EN',
  },
  en: {
    'Online ordering': 'Online ordering',
    'Shopping cart': 'Cart',
    'Welcome': 'Welcome',
    'Pick your favorites and order directly.': 'Pick your favorites and order directly.',
    'Order online, leave your contact details, and submit. The store will contact you to confirm.': 'Order online, leave your contact details, and submit. The store will contact you to confirm.',
    'All': 'All',
    'Add-ons': 'Add-ons',
    'Lunch': 'Lunch',
    'Dinner': 'Dinner',
    'Order by {time} (Malaysia time)': 'Order by {time} (Malaysia time)',
    'Menu is being prepared': 'Menu is being prepared',
    'No products are currently available for purchase.': 'No products are currently available for purchase.',
    'Selected {count}': 'Selected {count}',
    'Add to cart': 'Add to cart',
    'Added to cart': 'Added to cart',
    '{count} items': '{count} items',
    'View cart': 'View cart',
    'Store not found': 'Store not found',
    'Please check that the store link is correct.': 'Please check that the store link is correct.',
    'Menu unavailable': 'Menu unavailable',
    'Please try again later.': 'Please try again later.',
    'Back to menu': 'Back to menu',
    'Confirm order': 'Confirm order',
    'Your cart is empty': 'Your cart is empty',
    'Choose products': 'Choose products',
    'Order details': 'Order details',
    'per item': '/ item',
    'Remove': 'Remove',
    'Total': 'Total',
    'Contact details': 'Contact details',
    'Order remark': 'Order remark',
    'Remark placeholder': 'e.g. Less ice, no spicy, leave at the front desk',
    'The store will contact you by phone to confirm your order.': 'The store will contact you by phone to confirm your order.',
    'Name': 'Name',
    'Phone number': 'Phone number',
    'What should we call you?': 'What should we call you?',
    'e.g. 0123456789': 'e.g. 0123456789',
    'Submitting...': 'Submitting...',
    'Submit order': 'Submit order',
    'Your cart contains an unavailable product. Please return to the menu.': 'Your cart contains an unavailable product. Please return to the menu.',
    'A meal in your cart has closed or is no longer available. Please return to the menu.': 'A meal in your cart has closed or is no longer available. Please return to the menu.',
    'Please check your name and phone number.': 'Please check your name and phone number.',
    'Order submission failed. Please try again later.': 'Order submission failed. Please try again later.',
    'Order submitted': 'Order submitted',
    'Order number': 'Order number',
    'The store received your order and will contact you by phone to confirm.': 'The store received your order and will contact you by phone to confirm.',
    'The order has been submitted. Keep the store contact details for confirmation.': 'The order has been submitted. Keep the store contact details for confirmation.',
    'Continue ordering': 'Continue ordering',
    'Pay using this QR code': 'Pay using this QR code',
    'Seller payment QR code': 'Seller payment QR code',
    'After payment, choose your receipt and it will upload automatically.': 'After payment, choose your receipt and it will upload automatically.',
    'Choose payment receipt': 'Choose payment receipt',
    'Uploading...': 'Uploading...',
    'Payment receipt uploaded': 'Payment receipt uploaded',
    'Cancel payment receipt': 'Cancel payment receipt',
    'Cancelling...': 'Cancelling...',
    'Payment receipt cancellation failed.': 'Payment receipt cancellation failed.',
    'Payment receipt upload failed.': 'Payment receipt upload failed.',
    'Payment receipt is too large.': 'Payment receipt cannot exceed 5 MB.',
    'Choose an image or PDF receipt.': 'Choose an image or PDF receipt.',
    'Decrease {name}': 'Decrease {name}',
    'Increase {name}': 'Increase {name}',
    'Chinese': '中文',
    'English': 'EN',
  },
}

interface LanguageContextValue {
  language: Language
  setLanguage: (language: Language) => void
  t: (key: string, values?: Record<string, string | number>) => string
}

const LanguageContext = createContext<LanguageContextValue | null>(null)

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<Language>(() => {
    try {
      return localStorage.getItem('store-language') === 'zh' ? 'zh' : 'en'
    } catch {
      return 'en'
    }
  })

  const setLanguage = (next: Language) => {
    setLanguageState(next)
    try { localStorage.setItem('store-language', next) } catch { /* storage may be unavailable */ }
  }

  useEffect(() => { document.documentElement.lang = language === 'en' ? 'en' : 'zh-CN' }, [language])
  const value = useMemo(() => ({ language, setLanguage, t: (key: string, values?: Record<string, string | number>) => {
    let result = translations[language][key] ?? key
    Object.entries(values ?? {}).forEach(([name, replacement]) => { result = result.replace(`{${name}}`, String(replacement)) })
    return result
  } }), [language])
  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>
}

export function useLanguage() {
  const value = useContext(LanguageContext)
  if (!value) throw new Error('useLanguage must be used within LanguageProvider')
  return value
}

export function LanguageToggle() {
  const { language, setLanguage, t } = useLanguage()
  return <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-0.5" role="group" aria-label="Language">
    <button type="button" onClick={() => setLanguage('zh')} aria-pressed={language === 'zh'} className={`rounded-md px-2 py-1 text-xs font-semibold transition ${language === 'zh' ? 'bg-white text-slate-950 shadow-sm' : 'text-slate-500 hover:text-slate-900'}`}>{t('Chinese')}</button>
    <button type="button" onClick={() => setLanguage('en')} aria-pressed={language === 'en'} className={`rounded-md px-2 py-1 text-xs font-semibold transition ${language === 'en' ? 'bg-white text-slate-950 shadow-sm' : 'text-slate-500 hover:text-slate-900'}`}>{t('English')}</button>
  </div>
}
