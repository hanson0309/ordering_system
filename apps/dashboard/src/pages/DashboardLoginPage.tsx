import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { ApiError, getOrganizations, login } from '../lib/api'
import { LanguageToggle, useLanguage } from '../lib/i18n'

export default function DashboardLoginPage() {
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const { t } = useLanguage()

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSubmitting(true)
    setError(null)
    try {
      await login(email, password)
      const organizations = await getOrganizations()
      if (organizations.organizations.length === 0) {
        setError(t('Login succeeded, but this account has no organization access.'))
        return
      }
      navigate('/dashboard')
    } catch (err) {
      setError(err instanceof ApiError && err.status === 401 ? t('Email or password is incorrect.') : t('Unable to log in right now. Please try again later.'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <main className="min-h-screen bg-slate-950 px-4 py-12 text-slate-900">
      <div className="mx-auto flex min-h-[calc(100vh-6rem)] max-w-md items-center">
        <form onSubmit={handleSubmit} className="w-full rounded-xl bg-white p-7 shadow-xl shadow-slate-950/20">
          <div className="relative mb-8">
            <div className="absolute right-0 top-0"><LanguageToggle /></div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-amber-600">Ordering System</p>
            <h1 className="mt-3 text-2xl font-semibold text-slate-950">{t('Enter organization dashboard')}</h1>
            <p className="mt-2 text-sm text-slate-500">{t('Use the administrator-provided account to manage orders and products. Registration is currently unavailable.')}</p>
          </div>

          <div className="space-y-4">
            <div>
              <label htmlFor="dashboard-email" className="mb-1.5 block text-sm font-medium text-slate-700">{t('Email')}</label>
              <input
                id="dashboard-email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2.5 outline-none transition focus:border-amber-500 focus:ring-2 focus:ring-amber-100"
              />
            </div>
            <div>
              <label htmlFor="dashboard-password" className="mb-1.5 block text-sm font-medium text-slate-700">{t('Password')}</label>
              <input
                id="dashboard-password"
                type="password"
                autoComplete="current-password"
                minLength={8}
                required
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2.5 outline-none transition focus:border-amber-500 focus:ring-2 focus:ring-amber-100"
              />
            </div>
          </div>

          {error && <p role="alert" className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

          <button
            type="submit"
            disabled={submitting}
            className="mt-6 w-full rounded-lg bg-slate-950 px-4 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitting ? t('Logging in...') : t('Log in')}
          </button>
        </form>
      </div>
    </main>
  )
}
