import { useEffect, useState } from 'react'
import TrendPage from './pages/TrendPage'
import LedgerPage from './pages/LedgerPage'
import FuelPage from './pages/FuelPage'
import ImportPage from './pages/ImportPage'

type TabKey = 'trend' | 'ledger' | 'fuel' | 'import'

const TABS: { key: TabKey; label: string }[] = [
  { key: 'trend', label: '趋势' },
  { key: 'ledger', label: '台账' },
  { key: 'fuel', label: '油价' },
  { key: 'import', label: '导入' },
]

export default function App() {
  const [tab, setTab] = useState<TabKey>(() => {
    const value = new URLSearchParams(window.location.search).get('tab')
    return value === 'ledger' || value === 'fuel' || value === 'import' ? value : 'trend'
  })
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    const stored = localStorage.getItem('cw-theme')
    return stored === 'dark' ? 'dark' : 'light'
  })

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    localStorage.setItem('cw-theme', theme)
  }, [theme])

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand"><i />车价观察</div>
        <nav className="tabs">
          {TABS.map((item) => (
            <button
              key={item.key}
              className={`tab${tab === item.key ? ' on' : ''}`}
              onClick={() => setTab(item.key)}
            >
              {item.label}
            </button>
          ))}
        </nav>
        <div className="topbar-right">
          <span className="topbar-meta">1 个群 · 1,079 条消息</span>
          <button className="theme-toggle" onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}>
            {theme === 'light' ? '夜间' : '日间'}
          </button>
        </div>
      </header>

      {tab === 'trend' && <TrendPage />}
      {tab === 'ledger' && <LedgerPage />}
      {tab === 'fuel' && <FuelPage />}
      {tab === 'import' && <ImportPage />}
    </div>
  )
}