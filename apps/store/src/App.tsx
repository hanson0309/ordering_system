import { BrowserRouter, Route, Routes } from 'react-router-dom'
import CartPage from './pages/CartPage'
import OrderConfirmationPage from './pages/OrderConfirmationPage'
import StoreLayout from './pages/StoreLayout'
import StorePage from './pages/StorePage'
import { LanguageProvider } from './lib/i18n'

export default function App() {
  return <LanguageProvider><BrowserRouter><Routes>
    <Route path="/:slug/menu/:regionSlug/:locationSlug" element={<StoreLayout />}>
      <Route index element={<StorePage />} />
      <Route path="cart" element={<CartPage />} />
      <Route path="order/:orderId" element={<OrderConfirmationPage />} />
    </Route>
  </Routes></BrowserRouter></LanguageProvider>
}
