import { useEffect, useMemo, useState } from 'react'
import {
  Banknote,
  CalendarDays,
  Car,
  Check,
  ChevronDown,
  CircleDollarSign,
  Download,
  Gamepad2,
  Gift,
  HeartPulse,
  Home,
  House,
  Keyboard,
  ListFilter,
  MoreHorizontal,
  Plane,
  Plus,
  Save,
  Search,
  Send,
  Settings,
  Shield,
  ShieldCheck,
  ShoppingBag,
  Smartphone,
  Sparkles,
  Trash2,
  TrendingUp,
  Upload,
  Utensils,
  Wallet,
  WalletCards,
  X
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { aiEntryMessages, createDraftsFromAiRecords, parseAiEntryRecords } from '@/lib/ai'
import { parseBackup, serializeBackup } from '@/lib/backup'
import { currentMonth, currentYear } from '@/lib/dates'
import { parseExcelFile } from '@/lib/excelImport'
import { countTransactionsByPeriod, searchLedger } from '@/lib/ledgerSearch'
import { formatCompactMoney, formatMoney, parseAmountCents } from '@/lib/money'
import { requestChatCompletion } from '@/lib/modelClient'
import { getAiApiKey, maskSecret, setAiApiKey } from '@/lib/secrets'
import { availableMonths, availableYears, createAnnualSummary, createMonthSummary, type AnnualMonthSummary } from '@/lib/statistics'
import { useAppStore } from '@/store'
import type { AiDraft, Category, Transaction, TransactionType } from '@/types'
import type { LedgerPeriod } from '@/lib/ledgerSearch'

type TabKey = 'home' | 'ledger' | 'stats' | 'settings'
type CaptureMode = 'ai' | 'manual'
type StatsView = 'month' | 'year'
type LedgerDateMode = 'all' | 'year' | 'month'

interface TransactionFormState {
  id?: string
  type: TransactionType
  date: string
  categoryId: string
  subcategoryId: string
  amount: string
  accountName: string
  memberName: string
  merchant: string
  note: string
}

interface CategoryVisual {
  icon: LucideIcon
  fg: string
  bg: string
}

const TAB_ITEMS: { key: TabKey; label: string; icon: typeof Home }[] = [
  { key: 'home', label: '首页', icon: Home },
  { key: 'ledger', label: '流水', icon: WalletCards },
  { key: 'stats', label: '统计', icon: ListFilter },
  { key: 'settings', label: '设置', icon: Settings }
]

const LEDGER_PERIOD_TABS: { key: LedgerPeriod; label: string }[] = [
  { key: 'today', label: '今天' },
  { key: 'month', label: '本月' },
  { key: 'year', label: '本年' },
  { key: 'all', label: '所有' }
]

const LEDGER_INITIAL_RENDER_COUNT = 80
const LEDGER_RENDER_INCREMENT = 80

const QUICK_EXAMPLES = ['停车12', '午饭18', '红包88.66', '补贴20']

const CATEGORY_VISUALS: Array<{ keywords: string[] } & CategoryVisual> = [
  { keywords: ['食品', '餐', '饭', '酒水'], icon: Utensils, fg: '#b66322', bg: '#fff1df' },
  { keywords: ['宝宝', '医疗', '教育'], icon: HeartPulse, fg: '#b95067', bg: '#ffe8ee' },
  { keywords: ['购物', '日常用品'], icon: ShoppingBag, fg: '#8b5a1f', bg: '#f6ead8' },
  { keywords: ['行车', '交通', '停车', '加油'], icon: Car, fg: '#3c6f9f', bg: '#e5f0ff' },
  { keywords: ['出差', '旅游'], icon: Plane, fg: '#5c63a8', bg: '#eceeff' },
  { keywords: ['居家', '房贷', '房租'], icon: House, fg: '#4e735c', bg: '#e7f2e8' },
  { keywords: ['金融', '保险'], icon: Shield, fg: '#557184', bg: '#e7f1f5' },
  { keywords: ['人情', '收礼'], icon: Gift, fg: '#a6533a', bg: '#ffe9df' },
  { keywords: ['通讯', '电话'], icon: Smartphone, fg: '#4b7774', bg: '#e4f2ef' },
  { keywords: ['休闲', '娱乐'], icon: Gamepad2, fg: '#7a5fa1', bg: '#f0e9ff' },
  { keywords: ['职业', '工资', '收入', '公积金', '补贴'], icon: Banknote, fg: '#17735f', bg: '#ddf3eb' }
]

const DEFAULT_VISUAL: CategoryVisual = { icon: MoreHorizontal, fg: '#66716d', bg: '#eef1ec' }

export default function App() {
  const [tab, setTab] = useState<TabKey>('home')
  const [captureOpen, setCaptureOpen] = useState(false)
  const [captureMode, setCaptureMode] = useState<CaptureMode>('ai')

  const openCapture = (mode: CaptureMode) => {
    setCaptureMode(mode)
    setCaptureOpen(true)
  }

  return (
    <main className="app-shell">
      <div className="phone-frame">
        {tab === 'home' && <HomePage goLedger={() => setTab('ledger')} openCapture={openCapture} />}
        {tab === 'ledger' && <LedgerPage openCapture={openCapture} />}
        {tab === 'stats' && <StatsPage />}
        {tab === 'settings' && <SettingsPage />}
      </div>
      <BottomNav active={tab} onTab={setTab} onCapture={() => openCapture('ai')} />
      <QuickCaptureSheet
        mode={captureMode}
        open={captureOpen}
        onClose={() => setCaptureOpen(false)}
        onModeChange={setCaptureMode}
      />
    </main>
  )
}

function BottomNav({ active, onTab, onCapture }: { active: TabKey; onTab: (tab: TabKey) => void; onCapture: () => void }) {
  return (
    <nav className="bottom-nav" aria-label="主导航">
      {TAB_ITEMS.slice(0, 2).map(item => <NavButton active={active === item.key} item={item} onClick={() => onTab(item.key)} key={item.key} />)}
      <button className="nav-capture" onClick={onCapture} aria-label="AI 快记">
        <Plus size={26} />
      </button>
      {TAB_ITEMS.slice(2).map(item => <NavButton active={active === item.key} item={item} onClick={() => onTab(item.key)} key={item.key} />)}
    </nav>
  )
}

function NavButton({ active, item, onClick }: { active: boolean; item: { label: string; icon: typeof Home }; onClick: () => void }) {
  const Icon = item.icon
  return (
    <button className={active ? 'nav-button active' : 'nav-button'} onClick={onClick}>
      <Icon size={20} />
      <span>{item.label}</span>
    </button>
  )
}

function HomePage({ goLedger, openCapture }: { goLedger: () => void; openCapture: (mode: CaptureMode) => void }) {
  const transactions = useAppStore(state => state.transactions)
  const categories = useAppStore(state => state.categories)
  const drafts = useAppStore(state => state.drafts)
  const settings = useAppStore(state => state.settings)
  const updateTransaction = useAppStore(state => state.updateTransaction)
  const deleteTransaction = useAppStore(state => state.deleteTransaction)
  const confirmDraft = useAppStore(state => state.confirmDraft)
  const discardDraft = useAppStore(state => state.discardDraft)
  const [editForm, setEditForm] = useState<TransactionFormState | null>(null)
  const hidden = settings.privacy.hideAmounts
  const confirmed = useMemo(() => transactions.filter(item => item.status === 'confirmed'), [transactions])
  const monthSummary = useMemo(() => createMonthSummary(transactions, categories, currentMonth()), [transactions, categories])
  const recent = useMemo(() => confirmed.slice(0, 6), [confirmed])
  const biggestExpense = monthSummary.expenseRank[0]
  const submitEdit = () => {
    if (!editForm?.id) return
    updateTransaction(editForm.id, formToTransaction(editForm))
    setEditForm(null)
  }

  return (
    <section className="screen home-screen">
      <header className="app-header">
        <div>
          <span>记一下</span>
          <h1>{formatMonthLabel(currentMonth())}</h1>
        </div>
        <span className="month-switch" aria-label="当前月份">
          <CalendarDays size={16} />
          本月
        </span>
      </header>

      <section className="month-card">
        <div className="month-card-head">
          <span>本月结余</span>
          <strong>{formatCompactMoney(monthSummary.balanceCents, hidden)}</strong>
        </div>
        <div className="month-card-grid">
          <MiniMetric title="收入" value={formatCompactMoney(monthSummary.incomeCents, hidden)} tone="income" />
          <MiniMetric title="支出" value={formatCompactMoney(monthSummary.expenseCents, hidden)} tone="expense" />
        </div>
        <p className="month-insight">
          <TrendingUp size={16} />
          {biggestExpense ? `本月最多花在 ${biggestExpense.name}，${biggestExpense.count} 笔。` : '还没有本月支出，先记第一笔。'}
        </p>
      </section>

      <section className="quick-dock">
        <button className="ai-dock-button" onClick={() => openCapture('ai')} type="button">
          <Sparkles size={20} />
          <span>
            <b>一句话快记</b>
            <small>停车12，午饭18，红包88.66</small>
          </span>
          <Send size={18} />
        </button>
        <button className="manual-dock-button" onClick={() => openCapture('manual')} type="button">
          <Keyboard size={20} />
          手动
        </button>
      </section>

      {drafts.length > 0 && (
        <section className="ledger-section">
          <SectionHeading title="待确认草稿" action={`${drafts.length} 条`} />
          <DraftList categories={categories} drafts={drafts} hidden={hidden} onConfirm={confirmDraft} onDiscard={discardDraft} />
        </section>
      )}

      <section className="ledger-section">
        <SectionHeading title="最近流水" action="查看全部" onAction={goLedger} />
        <TransactionGroups
          categories={categories}
          emptyText="还没有正式流水。可以点底部 + 先记一笔。"
          hidden={hidden}
          onEdit={transaction => setEditForm(transactionToForm(transaction))}
          transactions={recent}
        />
      </section>
      <EditTransactionSheet
        categories={categories}
        form={editForm}
        onChange={setEditForm}
        onClose={() => setEditForm(null)}
        onDelete={id => {
          deleteTransaction(id)
          setEditForm(null)
        }}
        onSubmit={submitEdit}
      />
    </section>
  )
}

function LedgerPage({ openCapture }: { openCapture: (mode: CaptureMode) => void }) {
  const transactions = useAppStore(state => state.transactions)
  const categories = useAppStore(state => state.categories)
  const settings = useAppStore(state => state.settings)
  const updateTransaction = useAppStore(state => state.updateTransaction)
  const deleteTransaction = useAppStore(state => state.deleteTransaction)
  const [query, setQuery] = useState('')
  const [type, setType] = useState<TransactionType | 'all'>('all')
  const [period, setPeriod] = useState<LedgerPeriod>('month')
  const [dateMode, setDateMode] = useState<LedgerDateMode>('all')
  const [ledgerYear, setLedgerYear] = useState(currentYear())
  const [ledgerMonth, setLedgerMonth] = useState(currentMonth())
  const [openLedgerPicker, setOpenLedgerPicker] = useState<'year' | 'month' | null>(null)
  const [aiAssist, setAiAssist] = useState(true)
  const [editForm, setEditForm] = useState<TransactionFormState | null>(null)
  const hidden = settings.privacy.hideAmounts
  const trimmedQuery = query.trim()
  const allPeriodDateFilter = period === 'all'
    ? dateMode === 'year'
      ? { year: ledgerYear }
      : dateMode === 'month'
        ? { month: ledgerMonth }
        : undefined
    : undefined
  const ledgerYears = useMemo(() => Array.from(new Set([ledgerYear, currentYear(), ...availableYears(transactions)])), [ledgerYear, transactions])
  const ledgerMonths = useMemo(() => Array.from(new Set([ledgerMonth, currentMonth(), ...availableMonths(transactions)])), [ledgerMonth, transactions])

  const periodCounts = useMemo(() => Object.fromEntries(
    LEDGER_PERIOD_TABS.map(item => [item.key, countTransactionsByPeriod(transactions, item.key)])
  ) as Record<LedgerPeriod, number>, [transactions])
  const searchResult = useMemo(() => searchLedger({
    transactions,
    categories,
    period,
    type,
    query,
    aiAssist,
    dateFilter: allPeriodDateFilter
  }), [transactions, categories, period, type, query, aiAssist, allPeriodDateFilter])
  const filtered = searchResult.items
  const filteredSummary = useMemo(() => summarizeTransactions(filtered), [filtered])
  const periodLabel = LEDGER_PERIOD_TABS.find(item => item.key === period)?.label || '账本'
  const periodCount = periodCounts[period]
  const hasSearch = trimmedQuery.length > 0
  const dateScopeLabel = period === 'all' && allPeriodDateFilter
    ? dateMode === 'year'
      ? `${ledgerYear}年`
      : formatMonthLabel(ledgerMonth)
    : periodLabel
  const canRelaxSearch = hasSearch && (period !== 'all' || type !== 'all' || dateMode !== 'all')
  const searchTerms = searchResult.aiTerms.filter(term => term !== trimmedQuery.toLowerCase()).slice(0, 5)
  const ledgerYearOptions = ledgerYears.map(item => ({ id: item, label: `${item}年` }))
  const ledgerMonthOptions = ledgerMonths.map(item => ({ id: item, label: formatMonthLabel(item) }))

  const startEdit = (transaction: Transaction) => {
    setEditForm(transactionToForm(transaction))
  }

  const submitEdit = () => {
    if (!editForm?.id) return
    updateTransaction(editForm.id, formToTransaction(editForm))
    setEditForm(null)
  }

  const handleEmptyAction = () => {
      if (canRelaxSearch) {
        setPeriod('all')
        setType('all')
        setDateMode('all')
        return
      }
    setQuery('')
  }

  return (
    <section className="screen">
      <PageHeader title="流水" subtitle={hasSearch ? `${dateScopeLabel} · ${filtered.length} 条匹配` : `${dateScopeLabel}账本 · ${allPeriodDateFilter ? filtered.length : periodCount} 条`} />

      <section className="ledger-toolbar">
        <div className="period-tabs" aria-label="账簿周期">
          {LEDGER_PERIOD_TABS.map(item => (
            <button
              key={item.key}
              className={period === item.key ? 'active' : ''}
              onClick={() => setPeriod(item.key)}
              type="button"
            >
              <span>{item.label}</span>
            </button>
          ))}
        </div>
        <div className="search-field" role="search" aria-label="搜索流水">
          <Search size={18} />
          <input aria-label="搜索账单" value={query} onChange={event => setQuery(event.target.value)} placeholder={`搜索${periodLabel}账单、分类、备注、金额、年月`} />
          {hasSearch && (
            <button className="search-clear" onClick={() => setQuery('')} type="button" aria-label="清空搜索">
              <X size={16} />
            </button>
          )}
          <button className={aiAssist ? 'smart-search-toggle active' : 'smart-search-toggle'} onClick={() => setAiAssist(value => !value)} type="button">
            <Sparkles size={14} />
            智能
          </button>
        </div>
        <div className="ledger-filter-row">
          <div className="filter-chips" aria-label="流水类型筛选">
            {[
              ['all', '全部'],
              ['expense', '支出'],
              ['income', '收入']
            ].map(([value, label]) => (
              <button
                key={value}
                className={type === value ? 'active' : ''}
                onClick={() => setType(value as TransactionType | 'all')}
                type="button"
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        {period === 'all' && (
          <div className="date-scope-panel">
            <div className="filter-chips date-scope-tabs" aria-label="所有账本时间筛选">
              {[
                ['all', '全部时间'],
                ['year', '按年'],
                ['month', '按月']
              ].map(([value, label]) => (
                <button
                  key={value}
                  className={dateMode === value ? 'active' : ''}
                  onClick={() => setDateMode(value as LedgerDateMode)}
                  type="button"
                >
                  {label}
                </button>
              ))}
            </div>
            {dateMode === 'year' && (
              <ChoicePicker
                className="ledger-date-choice"
                label={`${ledgerYear}年`}
                open={openLedgerPicker === 'year'}
                options={ledgerYearOptions}
                value={ledgerYear}
                onClose={() => setOpenLedgerPicker(null)}
                onSelect={value => {
                  setLedgerYear(value)
                  setOpenLedgerPicker(null)
                }}
                onToggle={() => setOpenLedgerPicker(openLedgerPicker === 'year' ? null : 'year')}
              />
            )}
            {dateMode === 'month' && (
              <ChoicePicker
                className="ledger-date-choice month-choice"
                label={formatMonthLabel(ledgerMonth)}
                open={openLedgerPicker === 'month'}
                options={ledgerMonthOptions}
                value={ledgerMonth}
                onClose={() => setOpenLedgerPicker(null)}
                onSelect={value => {
                  setLedgerMonth(value)
                  setOpenLedgerPicker(null)
                }}
                onToggle={() => setOpenLedgerPicker(openLedgerPicker === 'month' ? null : 'month')}
              />
            )}
          </div>
        )}
        {hasSearch && aiAssist && (
          <p className={searchResult.aiMatchedCount > 0 ? 'ai-search-note matched' : 'ai-search-note'}>
            <Sparkles size={15} />
            {searchResult.aiMatchedCount > 0 ? `本地智能多找到 ${searchResult.aiMatchedCount} 条相近流水。` : '已尝试本地智能扩展，未发送历史流水。'}
            {searchTerms.length > 0 && <span>也查：{searchTerms.join('、')}</span>}
          </p>
        )}
        <div className="ledger-summary ledger-summary-strip">
          <MiniMetric title="收入" value={formatCompactMoney(filteredSummary.incomeCents, hidden)} tone="income" />
          <MiniMetric title="支出" value={formatCompactMoney(filteredSummary.expenseCents, hidden)} tone="expense" />
          <MiniMetric title="结余" value={formatCompactMoney(filteredSummary.balanceCents, hidden)} tone="balance" />
        </div>
      </section>

      <EditTransactionSheet
        categories={categories}
        form={editForm}
        onChange={setEditForm}
        onClose={() => setEditForm(null)}
        onDelete={id => {
          deleteTransaction(id)
          setEditForm(null)
        }}
        onSubmit={submitEdit}
      />

      <section className="ledger-section">
        <SectionHeading title={`${dateScopeLabel}明细`} action="记一笔" onAction={() => openCapture('manual')} />
        <TransactionGroups
          categories={categories}
          emptyText={hasSearch ? (canRelaxSearch ? '当前范围没有匹配，放宽到所有账单再试试。' : '没有匹配的流水，可以清空搜索或换个说法。') : `${periodLabel}还没有流水。`}
          hidden={hidden}
          onEmptyAction={hasSearch ? handleEmptyAction : undefined}
          emptyActionLabel={hasSearch ? (canRelaxSearch ? '放宽范围再搜' : '清空搜索') : undefined}
          onEdit={startEdit}
          transactions={filtered}
        />
      </section>
    </section>
  )
}

function EditTransactionSheet({ categories, form, onChange, onClose, onDelete, onSubmit }: {
  categories: Category[]
  form: TransactionFormState | null
  onChange: (form: TransactionFormState | null) => void
  onClose: () => void
  onDelete: (id: string) => void
  onSubmit: () => void
}) {
  if (!form) return null

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <section className="capture-sheet" role="dialog" aria-modal="true" aria-label="编辑流水" onClick={event => event.stopPropagation()}>
        <div className="sheet-grip" />
        <header className="sheet-head">
          <div>
            <span>流水详情</span>
            <h2>编辑流水</h2>
          </div>
          <button className="icon-button ghost" onClick={onClose} aria-label="关闭">
            <X size={22} />
          </button>
        </header>
        <TransactionForm
          categories={categories}
          compact
          form={form}
          onCancel={onClose}
          onChange={nextForm => onChange(nextForm)}
          onDelete={form.id ? () => {
            if (window.confirm('确认删除这笔流水？')) onDelete(form.id!)
          } : undefined}
          onSubmit={onSubmit}
          title="编辑流水"
        />
      </section>
    </div>
  )
}

function StatsPage() {
  const transactions = useAppStore(state => state.transactions)
  const categories = useAppStore(state => state.categories)
  const hidden = useAppStore(state => state.settings.privacy.hideAmounts)
  const months = useMemo(() => availableMonths(transactions), [transactions])
  const years = useMemo(() => availableYears(transactions), [transactions])
  const [view, setView] = useState<StatsView>('month')
  const [openStatsPicker, setOpenStatsPicker] = useState<'year' | 'month' | null>(null)
  const [month, setMonth] = useState(() => months[0] || currentMonth())
  const [year, setYear] = useState(() => years[0] || currentYear())
  const monthOptions = useMemo(() => {
    return Array.from(new Set([month, currentMonth(), ...months])).map(item => ({ id: item, label: formatMonthLabel(item) }))
  }, [month, months])
  const yearOptions = useMemo(() => {
    return Array.from(new Set([year, ...years])).map(item => ({ id: item, label: item }))
  }, [year, years])
  const chooseMonth = (nextMonth: string) => {
    setMonth(nextMonth)
    setOpenStatsPicker(null)
  }
  const chooseYear = (nextYear: string) => {
    setYear(nextYear)
    setOpenStatsPicker(null)
  }
  const monthSummary = useMemo(() => createMonthSummary(transactions, categories, month), [transactions, categories, month])
  const annual = useMemo(() => createAnnualSummary(transactions, categories, year), [transactions, categories, year])

  return (
    <section className="screen">
      <PageHeader title="统计" subtitle="月报和年报分开看" />

      <div className="report-switch">
        <button className={view === 'month' ? 'active' : ''} onClick={() => setView('month')} type="button">月报</button>
        <button className={view === 'year' ? 'active' : ''} onClick={() => setView('year')} type="button">年报</button>
      </div>

      {view === 'month' ? (
        <section className="report-card">
          <div className="report-head">
            <div>
              <span>月度账单</span>
              <h2>{formatMonthLabel(month)}</h2>
            </div>
            <ChoicePicker
              className="month-choice"
              label={formatMonthLabel(month)}
              open={openStatsPicker === 'month'}
              options={monthOptions}
              value={month}
              onClose={() => setOpenStatsPicker(null)}
              onSelect={chooseMonth}
              onToggle={() => setOpenStatsPicker(openStatsPicker === 'month' ? null : 'month')}
            />
          </div>
          <section className="metric-grid">
            <Metric title="收入" value={formatCompactMoney(monthSummary.incomeCents, hidden)} tone="income" />
            <Metric title="支出" value={formatCompactMoney(monthSummary.expenseCents, hidden)} tone="expense" />
            <Metric title="结余" value={formatCompactMoney(monthSummary.balanceCents, hidden)} tone="balance" />
          </section>
          <RankList title="本月支出分类" items={monthSummary.expenseRank} hidden={hidden} />
          <RankList title="本月收入来源" items={monthSummary.incomeRank} hidden={hidden} />
        </section>
      ) : (
        <section className="report-card">
          <div className="report-head">
            <div>
              <span>年度账单</span>
              <h2>{year}</h2>
            </div>
            <ChoicePicker
              className="year-choice"
              label={year}
              open={openStatsPicker === 'year'}
              options={yearOptions}
              value={year}
              onClose={() => setOpenStatsPicker(null)}
              onSelect={chooseYear}
              onToggle={() => setOpenStatsPicker(openStatsPicker === 'year' ? null : 'year')}
            />
          </div>
          <section className="metric-grid">
            <Metric title="年收入" value={formatCompactMoney(annual.incomeCents, hidden)} tone="income" />
            <Metric title="年支出" value={formatCompactMoney(annual.expenseCents, hidden)} tone="expense" />
            <Metric title="年结余" value={formatCompactMoney(annual.balanceCents, hidden)} tone="balance" />
          </section>
          <div className="chart-box">
            <div className="chart-title">
              <span><TrendingUp size={16} /> 12 个月趋势</span>
              <div>
                <i className="income-dot" />收入
                <i className="expense-dot" />支出
              </div>
            </div>
            <AnnualTrendChart months={annual.months} />
          </div>
          <RankList title="年度支出分类排行" items={annual.expenseRank} hidden={hidden} />
          <RankList title="年度收入来源排行" items={annual.incomeRank} hidden={hidden} />
        </section>
      )}
    </section>
  )
}

function SettingsPage() {
  const transactions = useAppStore(state => state.transactions)
  const categories = useAppStore(state => state.categories)
  const drafts = useAppStore(state => state.drafts)
  const settings = useAppStore(state => state.settings)
  const importSummary = useAppStore(state => state.importSummary)
  const importExcelData = useAppStore(state => state.importExcelData)
  const restoreBackup = useAppStore(state => state.restoreBackup)
  const updateSettings = useAppStore(state => state.updateSettings)
  const resetAll = useAppStore(state => state.resetAll)
  const [apiKey, setApiKeyValue] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)

  const importExcel = async (file?: File) => {
    if (!file) return
    setBusy(true)
    setNotice('')
    try {
      const result = await parseExcelFile(file)
      importExcelData(result.transactions, result.categories, result.summary)
      setNotice(`已导入 ${result.summary.transactionCount} 条流水。`)
    } catch (err) {
      setNotice(err instanceof Error ? err.message : '导入失败。')
    } finally {
      setBusy(false)
    }
  }

  const exportBackup = () => {
    const text = serializeBackup({ transactions, categories, drafts, settings, importSummary })
    const blob = new Blob([text], { type: 'application/json;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `jiyixia-backup-${new Date().toISOString().slice(0, 10)}.json`
    link.click()
    URL.revokeObjectURL(url)
  }

  const restore = async (file?: File) => {
    if (!file) return
    const text = await file.text()
    const backup = parseBackup(text)
    restoreBackup(backup)
    setNotice('备份已恢复。')
  }

  return (
    <section className="screen">
      <PageHeader title="设置" subtitle="本地优先，自己掌握数据" />
      {notice && <p className="notice">{notice}</p>}

      <section className="settings-card">
        <SectionHeading title="MiniMax 接入" action={maskSecret(getAiApiKey())} />
        <label>
          服务地址
          <input value={settings.model.baseUrl} onChange={event => updateSettings({ model: { baseUrl: event.target.value } })} />
        </label>
        <label>
          模型
          <input value={settings.model.model} onChange={event => updateSettings({ model: { model: event.target.value } })} />
        </label>
        <label>
          API Key
          <input value={apiKey} onChange={event => setApiKeyValue(event.target.value)} placeholder="只保存在本机浏览器存储" type="password" />
        </label>
        <button className="primary-button" onClick={() => {
          setAiApiKey(apiKey)
          setApiKeyValue('')
          setNotice('访问密钥已保存。')
        }}>
          <Save size={18} />
          保存密钥
        </button>
      </section>

      <section className="settings-card">
        <SectionHeading title="Excel 导入" icon={Upload} />
        <label className="file-button">
          {busy ? '导入中...' : '选择随手记 Excel'}
          <input type="file" accept=".xlsx,.xls" onChange={event => void importExcel(event.target.files?.[0])} />
        </label>
        {importSummary && (
          <p className="hint">
            已导入 {importSummary.transactionCount} 条，范围 {importSummary.dateStart} 至 {importSummary.dateEnd}。
          </p>
        )}
      </section>

      <section className="settings-card">
        <SectionHeading title="备份与隐私" icon={Download} />
        <button className="secondary-button" onClick={exportBackup}>
          <Download size={18} />
          导出 JSON 备份
        </button>
        <label className="file-button secondary">
          恢复 JSON 备份
          <input type="file" accept=".json" onChange={event => void restore(event.target.files?.[0])} />
        </label>
        <label className="toggle-row">
          <span>隐藏金额</span>
          <input
            type="checkbox"
            checked={settings.privacy.hideAmounts}
            onChange={event => updateSettings({ privacy: { hideAmounts: event.target.checked } })}
          />
        </label>
        <button className="danger-button" onClick={() => {
          if (window.confirm('确认清空本地数据？')) resetAll()
        }}>
          <Trash2 size={18} />
          清空本地数据
        </button>
      </section>
    </section>
  )
}

function QuickCaptureSheet({ mode, open, onClose, onModeChange }: {
  mode: CaptureMode
  open: boolean
  onClose: () => void
  onModeChange: (mode: CaptureMode) => void
}) {
  const categories = useAppStore(state => state.categories)
  const drafts = useAppStore(state => state.drafts)
  const settings = useAppStore(state => state.settings)
  const addDrafts = useAppStore(state => state.addDrafts)
  const addTransaction = useAppStore(state => state.addTransaction)
  const confirmDraft = useAppStore(state => state.confirmDraft)
  const discardDraft = useAppStore(state => state.discardDraft)
  const hidden = settings.privacy.hideAmounts
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [form, setForm] = useState(() => createEmptyForm(categories, 'expense'))

  if (!open) return null

  const runAi = async () => {
    setError('')
    setLoading(true)
    try {
      const apiKey = getAiApiKey()
      const result = await requestChatCompletion(settings.model, apiKey, aiEntryMessages(input, categories))
      const parsed = parseAiEntryRecords(result.content)
      const created = createDraftsFromAiRecords(parsed, input, categories)
      addDrafts(created.drafts, created.categories)
      setInput('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'AI 解析失败。')
    } finally {
      setLoading(false)
    }
  }

  const submitManual = () => {
    addTransaction(formToTransaction(form))
    setForm(createEmptyForm(categories, form.type, form))
    onClose()
  }

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <section className="capture-sheet" role="dialog" aria-modal="true" aria-label="记一笔" onClick={event => event.stopPropagation()}>
        <div className="sheet-grip" />
        <header className="sheet-head">
          <div>
            <span>快速入账</span>
            <h2>{mode === 'ai' ? '一句话快记' : '手动记一笔'}</h2>
          </div>
          <button className="icon-button ghost" onClick={onClose} aria-label="关闭">
            <X size={22} />
          </button>
        </header>

        <div className="sheet-tabs">
          <button className={mode === 'ai' ? 'active' : ''} onClick={() => onModeChange('ai')} type="button">
            <Sparkles size={17} />
            AI 快记
          </button>
          <button className={mode === 'manual' ? 'active' : ''} onClick={() => onModeChange('manual')} type="button">
            <Keyboard size={17} />
            手动
          </button>
        </div>

        {mode === 'ai' ? (
          <div className="sheet-ai">
            <textarea
              value={input}
              onChange={event => setInput(event.target.value)}
              placeholder="例如：停车12，午饭18，红包88.66，补贴20"
            />
            <div className="quick-chips">
              {QUICK_EXAMPLES.map(example => (
                <button key={example} type="button" onClick={() => setInput(example)}>{example}</button>
              ))}
            </div>
            <button className="primary-button" disabled={!input.trim() || loading} onClick={runAi}>
              <Send size={18} />
              {loading ? '解析中...' : '生成待确认草稿'}
            </button>
            {error && <p className="inline-error">{error}</p>}
            <p className="hint">
              <ShieldCheck size={15} />
              只发送本次输入和分类表，不发送历史流水。
            </p>
            {drafts.length > 0 && (
              <DraftList categories={categories} drafts={drafts} hidden={hidden} onConfirm={confirmDraft} onDiscard={discardDraft} />
            )}
          </div>
        ) : (
          <TransactionForm
            categories={categories}
            compact
            form={form}
            onCancel={onClose}
            onChange={setForm}
            onSubmit={submitManual}
            title="手动记一笔"
          />
        )}
      </section>
    </div>
  )
}

function TransactionForm({ form, categories, onChange, onSubmit, onCancel, onDelete, title, compact = false }: {
  form: TransactionFormState
  categories: Category[]
  onChange: (form: TransactionFormState) => void
  onSubmit: () => void
  onCancel: () => void
  onDelete?: () => void
  title: string
  compact?: boolean
}) {
  const [openPicker, setOpenPicker] = useState<'category' | 'subcategory' | null>(null)
  const categoryOptions = categories.filter(item => item.type === form.type)
  const activeCategory = categoryOptions.find(item => item.id === form.categoryId) || categoryOptions[0]
  const patch = (patch: Partial<TransactionFormState>) => onChange({ ...form, ...patch })
  const chooseCategory = (categoryId: string) => {
    const nextCategory = categoryOptions.find(item => item.id === categoryId) || categoryOptions[0]
    patch({ categoryId: nextCategory.id, subcategoryId: nextCategory.subcategories[0]?.id || '' })
    setOpenPicker(null)
  }
  const chooseSubcategory = (subcategoryId: string) => {
    patch({ subcategoryId })
    setOpenPicker(null)
  }

  return (
    <section className={compact ? 'form-panel compact-form' : 'form-panel'}>
      {!compact && (
        <div className="form-head">
          <h2>{title}</h2>
          <button className="text-button" onClick={onCancel}>取消</button>
        </div>
      )}
      <input className="amount-input" value={form.amount} onChange={event => patch({ amount: event.target.value })} inputMode="decimal" placeholder="金额，元" />
      <div className="sheet-tabs compact">
        {(['expense', 'income'] as TransactionType[]).map(nextType => (
          <button
            key={nextType}
            className={form.type === nextType ? 'active' : ''}
            onClick={() => onChange(createEmptyForm(categories, nextType, form))}
            type="button"
          >
            {nextType === 'expense' ? '支出' : '收入'}
          </button>
        ))}
      </div>
      <div className="form-grid">
        <DateTimePicker value={form.date} onChange={date => patch({ date })} />
        <ChoicePicker
          label={activeCategory?.name || '选择分类'}
          open={openPicker === 'category'}
          options={categoryOptions.map(item => ({ id: item.id, label: item.name }))}
          value={form.categoryId}
          onClose={() => setOpenPicker(null)}
          onSelect={chooseCategory}
          onToggle={() => setOpenPicker(openPicker === 'category' ? null : 'category')}
        />
        <ChoicePicker
          label={activeCategory?.subcategories.find(item => item.id === form.subcategoryId)?.name || '选择二级'}
          open={openPicker === 'subcategory'}
          options={(activeCategory?.subcategories || []).map(item => ({ id: item.id, label: item.name }))}
          value={form.subcategoryId}
          onClose={() => setOpenPicker(null)}
          onSelect={chooseSubcategory}
          onToggle={() => setOpenPicker(openPicker === 'subcategory' ? null : 'subcategory')}
        />
        <input value={form.accountName} onChange={event => patch({ accountName: event.target.value })} placeholder="账户" />
        <input value={form.merchant} onChange={event => patch({ merchant: event.target.value })} placeholder="商家" />
      </div>
      <textarea value={form.note} onChange={event => patch({ note: event.target.value })} placeholder="备注" />
      <div className="form-actions">
        <button className="primary-button" disabled={!form.amount.trim()} onClick={onSubmit}>
          <Save size={18} />
          {form.id ? '保存修改' : '加入流水'}
        </button>
        {onDelete && (
          <button className="danger-button" onClick={onDelete} type="button">
            <Trash2 size={18} />
            删除流水
          </button>
        )}
      </div>
    </section>
  )
}

function ChoicePicker({ label, value, options, open, onToggle, onClose, onSelect, className = '' }: {
  label: string
  value: string
  options: { id: string; label: string }[]
  open: boolean
  onToggle: () => void
  onClose: () => void
  onSelect: (id: string) => void
  className?: string
}) {
  return (
    <div
      className={`choice-picker ${className}`.trim()}
      onBlur={event => {
        const nextTarget = event.relatedTarget instanceof Node ? event.relatedTarget : null
        if (!event.currentTarget.contains(nextTarget)) onClose()
      }}
    >
      <button className="choice-button" type="button" onClick={onToggle} aria-expanded={open}>
        <span>{label}</span>
        <ChevronDown size={16} />
      </button>
      {open && (
        <div className="choice-menu" role="listbox">
          {options.map(option => (
            <button
              className={option.id === value ? 'active' : ''}
              key={option.id}
              onMouseDown={event => event.preventDefault()}
              onClick={() => onSelect(option.id)}
              role="option"
              aria-selected={option.id === value}
              type="button"
            >
              {option.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function DateTimePicker({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <label className="picker-field datetime-field">
      <span>{formatDateTimeLabel(value)}</span>
      <CalendarDays size={16} />
      <input aria-label="选择日期时间" type="datetime-local" value={value} onChange={event => onChange(event.target.value)} />
    </label>
  )
}

function PageHeader({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <header className="page-header">
      <h1>{title}</h1>
      <p>{subtitle}</p>
    </header>
  )
}

function SectionHeading({ title, action, icon: Icon, onAction }: {
  title: string
  action?: string
  icon?: LucideIcon
  onAction?: () => void
}) {
  return (
    <div className="section-heading">
      <h2>{title}</h2>
      {action && (
        onAction ? (
          <button onClick={onAction} type="button">
            {action}
          </button>
        ) : (
          <span className="section-action-label">{action}</span>
        )
      )}
      {Icon && <Icon size={20} />}
    </div>
  )
}

function Metric({ title, value, tone }: { title: string; value: string; tone: 'income' | 'expense' | 'balance' }) {
  return (
    <article className={`metric ${tone}`}>
      <span>{title}</span>
      <strong>{value}</strong>
    </article>
  )
}

function MiniMetric({ title, value, tone }: { title: string; value: string; tone: 'income' | 'expense' | 'balance' }) {
  return (
    <div className={`mini-metric ${tone}`}>
      <span>{title}</span>
      <strong>{value}</strong>
    </div>
  )
}

function AnnualTrendChart({ months }: { months: AnnualMonthSummary[] }) {
  const max = Math.max(1, ...months.flatMap(item => [item.incomeCents, item.expenseCents]))
  const heightOf = (value: number) => value > 0 ? `${Math.max(4, Math.round((value / max) * 100))}%` : '0%'

  return (
    <div className="annual-trend" aria-label="12 个月收入支出趋势">
      {months.map(item => (
        <div className="trend-month" key={item.month}>
          <div className="trend-bars">
            <i className="trend-income" style={{ height: heightOf(item.incomeCents) }} title={`${item.month} 收入 ${formatMoney(item.incomeCents)}`} />
            <i className="trend-expense" style={{ height: heightOf(item.expenseCents) }} title={`${item.month} 支出 ${formatMoney(item.expenseCents)}`} />
          </div>
          <span>{Number(item.month.slice(5))}</span>
        </div>
      ))}
    </div>
  )
}

function DraftList({ drafts, categories, hidden, onConfirm, onDiscard }: {
  drafts: AiDraft[]
  categories: Category[]
  hidden: boolean
  onConfirm: (id: string) => void
  onDiscard: (id: string) => void
}) {
  return (
    <div className="draft-list">
      {drafts.map(draft => (
        <article className="draft-card" key={draft.id}>
          <TransactionRow categories={categories} hidden={hidden} transaction={draft} />
          {draft.warnings && draft.warnings.length > 0 && (
            <div className="warning-list">
              {draft.warnings.map(warning => <span key={warning}>{warning}</span>)}
            </div>
          )}
          <div className="row-actions">
            <button className="small-button success" onClick={() => onConfirm(draft.id)}>
              <Check size={16} />
              入账
            </button>
            <button className="small-button ghost" onClick={() => onDiscard(draft.id)}>
              <Trash2 size={16} />
              丢弃
            </button>
          </div>
        </article>
      ))}
    </div>
  )
}

function TransactionGroups({ transactions, categories, hidden, emptyText, emptyActionLabel, onEmptyAction, onEdit }: {
  transactions: Transaction[]
  categories: Category[]
  hidden: boolean
  emptyText: string
  emptyActionLabel?: string
  onEmptyAction?: () => void
  onEdit?: (transaction: Transaction) => void
}) {
  const [visibleCount, setVisibleCount] = useState(LEDGER_INITIAL_RENDER_COUNT)
  const visibleTransactions = useMemo(() => transactions.slice(0, visibleCount), [transactions, visibleCount])
  const groups = useMemo(() => groupTransactionsByDate(visibleTransactions), [visibleTransactions])
  const shownCount = Math.min(visibleCount, transactions.length)
  const hasMore = shownCount < transactions.length

  useEffect(() => {
    setVisibleCount(LEDGER_INITIAL_RENDER_COUNT)
  }, [transactions])

  if (groups.length === 0) return <EmptyState text={emptyText} actionLabel={emptyActionLabel} onAction={onEmptyAction} />

  return (
    <div className="date-groups">
      {groups.map(group => (
        <section className="date-group" key={group.date}>
          <div className="date-group-head">
            <h3>{formatDateGroupTitle(group.date)}</h3>
            <span>{group.items.length} 笔</span>
          </div>
          <div className="ledger-list">
            {group.items.map(item => (
              onEdit ? (
                <button
                  className="ledger-item ledger-item-button"
                  key={item.id}
                  onClick={() => onEdit(item)}
                  type="button"
                >
                  <TransactionRow categories={categories} hidden={hidden} transaction={item} />
                </button>
              ) : (
                <article className="ledger-item" key={item.id}>
                  <TransactionRow categories={categories} hidden={hidden} transaction={item} />
                </article>
              )
            ))}
          </div>
        </section>
      ))}
      {hasMore && (
        <div className="load-more-panel">
          <span>已显示 {shownCount} / {transactions.length} 笔</span>
          <button type="button" onClick={() => setVisibleCount(count => Math.min(count + LEDGER_RENDER_INCREMENT, transactions.length))}>
            再加载 {Math.min(LEDGER_RENDER_INCREMENT, transactions.length - shownCount)} 笔
          </button>
        </div>
      )}
    </div>
  )
}

function TransactionRow({ transaction, categories, hidden }: { transaction: Transaction; categories: Category[]; hidden: boolean }) {
  const category = getCategory(categories, transaction.categoryId)
  const subcategory = getSubcategory(categories, transaction.categoryId, transaction.subcategoryId)
  const visual = getCategoryVisual(category?.name, subcategory?.name, transaction.type)
  const Icon = visual.icon
  const meta = [transaction.date.slice(11, 16), transaction.accountName].filter(Boolean).join(' · ')
  const detail = [transaction.merchant, transaction.note].filter(Boolean).join(' · ')

  return (
    <div className="transaction-row">
      <span className="category-avatar" style={{ color: visual.fg, backgroundColor: visual.bg }}>
        <Icon size={20} />
      </span>
      <div className="transaction-copy">
        <strong>{subcategory?.name || category?.name || '未分类'}</strong>
        <span>{meta}</span>
        {detail && <p>{detail}</p>}
      </div>
      <b className={transaction.type === 'income' ? 'amount income-text' : 'amount expense-text'}>
        {transaction.type === 'income' ? '+' : '-'}{formatCompactMoney(transaction.amountCents, hidden)}
      </b>
    </div>
  )
}

function RankList({ title, items, hidden }: { title: string; items: { id: string; name: string; amountCents: number; count: number }[]; hidden: boolean }) {
  const max = items[0]?.amountCents || 1
  return (
    <div className="rank-list">
      <h3>{title}</h3>
      {items.length === 0 ? <EmptyState text="暂无数据。" /> : items.slice(0, 8).map(item => (
        <div className="rank-row" key={item.id}>
          <div>
            <span>{item.name}</span>
            <small>{item.count} 笔</small>
          </div>
          <div className="rank-value">
            <b>{formatCompactMoney(item.amountCents, hidden)}</b>
            <i style={{ width: `${Math.max(8, (item.amountCents / max) * 100)}%` }} />
          </div>
        </div>
      ))}
    </div>
  )
}

function EmptyState({ text, actionLabel, onAction }: { text: string; actionLabel?: string; onAction?: () => void }) {
  return (
    <div className="empty-state">
      <p>{text}</p>
      {actionLabel && onAction && <button type="button" onClick={onAction}>{actionLabel}</button>}
    </div>
  )
}

function summarizeTransactions(items: Transaction[]) {
  return items.reduce(
    (summary, item) => {
      if (item.status !== 'confirmed') return summary
      if (item.type === 'income') {
        summary.incomeCents += item.amountCents
      } else {
        summary.expenseCents += item.amountCents
      }
      summary.balanceCents = summary.incomeCents - summary.expenseCents
      return summary
    },
    { incomeCents: 0, expenseCents: 0, balanceCents: 0 }
  )
}

function groupTransactionsByDate(transactions: Transaction[]) {
  const sorted = [...transactions]
    .filter(item => item.status === 'confirmed')
    .sort((a, b) => b.date.localeCompare(a.date))
  const groups: { date: string; items: Transaction[] }[] = []

  for (const item of sorted) {
    const date = item.date.slice(0, 10)
    const group = groups.find(existing => existing.date === date)
    if (group) {
      group.items.push(item)
    } else {
      groups.push({ date, items: [item] })
    }
  }

  return groups
}

function formatMonthLabel(month: string) {
  const [year, monthNumber] = month.split('-')
  return `${year}年${Number(monthNumber)}月`
}

function formatDateTimeLabel(value: string) {
  if (!value) return '选择日期时间'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  const month = `${date.getMonth() + 1}`.padStart(2, '0')
  const day = `${date.getDate()}`.padStart(2, '0')
  const hour = `${date.getHours()}`.padStart(2, '0')
  const minute = `${date.getMinutes()}`.padStart(2, '0')
  return `${date.getFullYear()}年${month}月${day}日 ${hour}:${minute}`
}

function formatDateGroupTitle(date: string) {
  const today = localDateKey(new Date())
  const yesterday = localDateKey(new Date(Date.now() - 24 * 60 * 60 * 1000))
  if (date === today) return '今天'
  if (date === yesterday) return '昨天'
  return new Date(`${date}T00:00:00`).toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'short' })
}

function localDateKey(date: Date) {
  const year = date.getFullYear()
  const month = `${date.getMonth() + 1}`.padStart(2, '0')
  const day = `${date.getDate()}`.padStart(2, '0')
  return `${year}-${month}-${day}`
}

function localDateTimeInputValue(date = new Date()) {
  const year = date.getFullYear()
  const month = `${date.getMonth() + 1}`.padStart(2, '0')
  const day = `${date.getDate()}`.padStart(2, '0')
  const hour = `${date.getHours()}`.padStart(2, '0')
  const minute = `${date.getMinutes()}`.padStart(2, '0')
  return `${year}-${month}-${day}T${hour}:${minute}`
}

function getCategoryVisual(categoryName = '', subcategoryName = '', type: TransactionType): CategoryVisual {
  if (type === 'income') return { icon: CircleDollarSign, fg: '#17735f', bg: '#ddf3eb' }
  const text = `${categoryName}${subcategoryName}`
  return CATEGORY_VISUALS.find(item => item.keywords.some(keyword => text.includes(keyword))) || DEFAULT_VISUAL
}

function createEmptyForm(categories: Category[], type: TransactionType, previous?: Partial<TransactionFormState>): TransactionFormState {
  const category = categories.find(item => item.type === type) || categories[0]
  return {
    type,
    date: localDateTimeInputValue(),
    categoryId: category.id,
    subcategoryId: category.subcategories[0]?.id || '',
    amount: '',
    accountName: previous?.accountName || '现金',
    memberName: '',
    merchant: '',
    note: ''
  }
}

function transactionToForm(transaction: Transaction): TransactionFormState {
  return {
    id: transaction.id,
    type: transaction.type,
    date: transaction.date.slice(0, 16),
    categoryId: transaction.categoryId,
    subcategoryId: transaction.subcategoryId,
    amount: (transaction.amountCents / 100).toString(),
    accountName: transaction.accountName,
    memberName: transaction.memberName,
    merchant: transaction.merchant,
    note: transaction.note
  }
}

function formToTransaction(form: TransactionFormState): Omit<Transaction, 'id' | 'source' | 'status' | 'createdAt' | 'updatedAt'> {
  return {
    type: form.type,
    date: form.date.length === 16 ? `${form.date}:00` : form.date,
    categoryId: form.categoryId,
    subcategoryId: form.subcategoryId,
    accountName: form.accountName || '现金',
    currency: 'CNY',
    amountCents: parseAmountCents(form.amount),
    memberName: '',
    merchant: form.merchant,
    projectCategory: '',
    projectName: '',
    note: form.note
  }
}

function getCategory(categories: Category[], id: string) {
  return categories.find(item => item.id === id)
}

function getSubcategory(categories: Category[], categoryId: string, subcategoryId: string) {
  return getCategory(categories, categoryId)?.subcategories.find(item => item.id === subcategoryId)
}
