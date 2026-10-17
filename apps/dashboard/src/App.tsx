import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import DashboardLoginPage from './pages/DashboardLoginPage'
import DashboardPage from './pages/DashboardPage'
import { LanguageProvider } from './lib/i18n'

export default function App() {
  return <LanguageProvider><BrowserRouter><Routes>
    <Route path="/" element={<Navigate to="/dashboard/login" replace />} />
    <Route path="/dashboard/login" element={<DashboardLoginPage />} />
    <Route path="/dashboard" element={<DashboardPage />} />
  </Routes></BrowserRouter></LanguageProvider>
}
