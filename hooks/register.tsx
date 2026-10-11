import type { EngineInterface, Register } from 'claude-code'

import type { Commit, Issue, Label, Memo, Milestone, Pr, SectionId, Snapshot } from '../types'

const PANE = 'project-progress'
const COMMAND = 'project-progress'
const TITLE = '專案進度'
const AUTO_REFRESH_MS = 10 * 60 * 1000
const COLLAPSED_ROWS = 6

const BAR_DONE = '#3fb950'
const BAR_LEFT = '#6e7681'

const EMPTY: Snapshot = {
  commits: [],
  milestones: [],
  issues: [],
  prs: [],
  merged: [],
  isLoading: false,
}

const MEMO_MAX = 300
const MEMO_DONE_SHOWN = 3

const SECTIONS: Array<{ id: SectionId; title: string; hotkey: string }> = [
  { id: 'memos', title: '備忘錄', hotkey: '0' },
  { id: 'milestones', title: '里程碑', hotkey: '1' },
  { id: 'issues', title: '未排入里程碑的 Issue', hotkey: '2' },
  { id: 'prs', title: '進行中的 PR', hotkey: '3' },
  { id: 'merged', title: '最近合併', hotkey: '4' },
  { id: 'commits', title: '最近提交', hotkey: '5' },
]

// 模組變數：熱載入時會重設，但 session.start 會再從 $.store 讀回上次的快照。
let snapshot: Snapshot = EMPTY
let showAll = false
let collapsed: Partial<Record<SectionId, boolean>> = { merged: true, commits: true }
let storeKey = ''
let isRefreshing = false

// 備忘錄狀態（模組變數，持久化在 $.store 的 memoKey）
let memos: Memo[] = []
let memoKey = ''
/** 正在編輯的備忘 id；undefined 表示輸入框用來新增。 */
let editingId: string | undefined
/** Input 的 key 帶世代號：送出後換新 key 才能可靠清空欄位，再把焦點移回去。 */
let inputGen = 0
let inputSeed = ''
let showDone = false
/** 最近一次刪除（單筆或清除已完成），可按 u 復原。 */
let lastRemoved: { items: Memo[]; label: string } | undefined
let memoNotice = ''

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    storeKey = 'snapshot:' + encodeURIComponent(e.cwd)
    memoKey = 'memo:' + encodeURIComponent(e.cwd)
    try {
      const saved = await $.store.get(memoKey)
      if (Array.isArray(saved)) memos = saved.filter(isMemo)
    } catch {
      // 讀不到就從空白開始
    }
    await $.command.register({
      name: COMMAND,
      description: '開啟專案進度面板：GitHub 里程碑、Issue、PR 與最近提交',
      immediate: true,
    })

    try {
      const cached = await $.store.get(storeKey)
      if (isSnapshot(cached)) snapshot = { ...cached, isLoading: false }
    } catch {
      // 讀不到快取就從空白開始
    }

    $.clock.every(AUTO_REFRESH_MS, () => {
      void (async () => {
        const panes = await $.ui.panes()
        if (panes.some(p => p.id === PANE && p.isPlaced)) await refresh($)
      })()
    })

    return next(e)
  })

  on('command.run', { command: COMMAND }, async $ => {
    const opened = await $.ui.open({ id: PANE, title: TITLE })
    void refresh($)
    return {
      text: opened.isPlaced
        ? `${TITLE}面板已開啟，正在更新資料。`
        : `${TITLE}面板已排入，但目前視窗太窄無法顯示，加寬後會自動出現。`,
    }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, ($, e) => {
    const { Box, Text, Button, Link } = $.ui.resolve(e)
    const s = snapshot
    const cols = Math.max(28, e.props.bodyColumns ?? e.viewport?.columns ?? 60)
    const inner = cols - 4 // 卡片框線與左右內距
    const limit = showAll ? Number.MAX_SAFE_INTEGER : COLLAPSED_ROWS
    const redraw = () => $.ui.invalidate('ui.render')

    const openMilestones = s.milestones.filter(m => m.state === 'open')
    const closedMilestones = s.milestones.filter(m => m.state === 'closed')
    const unassigned = s.issues.filter(i => !i.milestone)
    const openMemos = memos.filter(m => !m.done)
    const doneMemos = memos.filter(m => m.done).sort((a, b) => (b.doneAt ?? 0) - (a.doneAt ?? 0))
    const counts: Record<SectionId, number> = {
      memos: openMemos.length,
      milestones: openMilestones.length,
      issues: unassigned.length,
      prs: s.prs.length,
      merged: s.merged.length,
      commits: s.commits.length,
    }

    const dim = (text: string) => <Text dimColor>{text}</Text>
    const chip = (text: string, color: string) => (
      <Text color={color} bold>
        {text}
      </Text>
    )
    const empty = (text: string) => (
      <Box paddingLeft={2}>
        <Text dimColor italic>
          {text}
        </Text>
      </Box>
    )
    const moreRow = (hidden: number) =>
      hidden > 0 ? (
        <Box paddingLeft={2}>
          <Button key={`more-${hidden}`} plain dimColor label={`… 還有 ${hidden} 筆，按 a 顯示全部`} onPress={() => { showAll = true; redraw() }} />
        </Box>
      ) : null

    const sectionHeader = (sec: (typeof SECTIONS)[number]) => {
      const isCollapsed = collapsed[sec.id] === true
      return (
        <Box marginTop={1} flexDirection="row" gap={1}>
          <Button
            key={`sec-${sec.id}`}
            plain
            hotkey={sec.hotkey}
            onPress={() => {
              collapsed = { ...collapsed, [sec.id]: !isCollapsed }
              redraw()
            }}
          >
            <Text bold color="claude">
              {isCollapsed ? '▸ ' : '▾ '}
              {sec.title}
            </Text>
            <Text dimColor> {counts[sec.id]}</Text>
          </Button>
        </Box>
      )
    }

    const numberLink = (n: number, url: string | undefined, color: string) =>
      url ? (
        <Link href={url}>
          <Text color={color} bold>{`#${n}`}</Text>
        </Link>
      ) : (
        <Text color={color} bold>{`#${n}`}</Text>
      )

    const issueRow = (i: Issue, indent: number) => {
      const chips = i.labels.slice(0, 3)
      const chipCells = chips.reduce((n, l) => n + cells(l.name) + 3, 0)
      const room = Math.max(8, inner - indent - 7 - chipCells)
      return (
        <Box key={`issue-${i.number}`} paddingLeft={indent} flexDirection="row">
          {numberLink(i.number, i.url, 'suggestion')}
          <Text hover={{ bold: true, color: 'claude' }}>{` ${fit(i.title, room)}`}</Text>
          {chips.map(l => (
            <Text color={labelColor(l)}>{` [${l.name}]`}</Text>
          ))}
        </Box>
      )
    }

    const prRow = (p: Pr) => {
      const tag = reviewTag(p.review)
      const extra = (p.isDraft ? 5 : 0) + (tag ? cells(tag.text) + 1 : 0)
      const room = Math.max(8, inner - 2 - 7 - extra)
      return (
        <Box key={`pr-${p.number}`} paddingLeft={2} flexDirection="row">
          {numberLink(p.number, p.url, 'permission')}
          <Text dimColor={p.isDraft} hover={{ bold: true, color: 'claude' }}>{` ${fit(p.title, room)}`}</Text>
          {p.isDraft && dim(' 草稿')}
          {tag && <Text color={tag.color}>{` ${tag.text}`}</Text>}
        </Box>
      )
    }

    const mergedRow = (p: Pr) => (
      <Box key={`merged-${p.number}`} paddingLeft={2} flexDirection="row">
        {dim(p.mergedAt ? day(p.mergedAt) : '     ')}
        <Text> </Text>
        {numberLink(p.number, p.url, 'merged')}
        <Text dimColor>{` ${fit(p.title, Math.max(8, inner - 2 - 6 - 7))}`}</Text>
      </Box>
    )

    const commitRow = (c: Commit) => {
      const kind = commitKind(c.subject)
      return (
        <Box key={`commit-${c.sha}`} paddingLeft={2} flexDirection="row">
          <Text color="inactive">{c.sha}</Text>
          {kind && <Text color={kind.color}>{` ${kind.text}`}</Text>}
          <Text dimColor>{` ${fit(kind ? c.subject.slice(kind.raw.length) : c.subject, Math.max(8, inner - 2 - 9 - (kind ? cells(kind.text) + 1 : 0)))}`}</Text>
        </Box>
      )
    }

    // ---- 備忘錄 ----
    // 手機版的元素表沒有 Input：那裡只顯示與勾選，不提供輸入。
    const els = $.ui.resolve(e)
    const Input = 'Input' in els ? els.Input : undefined
    const inputKey = `memo-input-${inputGen}`
    const editing = editingId ? memos.find(m => m.id === editingId) : undefined

    const memoRow = (m: Memo) => {
      const room = Math.max(8, inner - 2 - 4 - 9 - 4)
      return (
        <Box key={`memo-${m.id}`} paddingLeft={2} flexDirection="row" justifyContent="space-between">
          <Box flexDirection="row">
            <Button
              key={`memo-check-${m.id}`}
              plain
              onPress={() => void toggleMemo($, m.id)}
            >
              <Text color={m.done ? 'success' : 'inactive'}>{m.done ? '☑ ' : '☐ '}</Text>
            </Button>
            <Button key={`memo-edit-${m.id}`} plain onPress={() => startEdit($, m)}>
              <Text
                dimColor={m.done}
                strikethrough={m.done}
                bold={m.id === editingId}
                color={m.id === editingId ? 'claude' : undefined}
                hover={{ bold: true, color: 'claude' }}
              >
                {fit(m.text, room)}
              </Text>
            </Button>
          </Box>
          <Box flexDirection="row">
            <Text dimColor>{ago(m.done && m.doneAt ? m.doneAt : m.createdAt)}</Text>
            <Button key={`memo-del-${m.id}`} plain onPress={() => void removeMemo($, m.id)}>
              <Text color="inactive" hover={{ color: 'error', bold: true }}>{'  ✕'}</Text>
            </Button>
          </Box>
        </Box>
      )
    }

    const memoSection = (
      <Box flexDirection="column">
        {Input ? (
          <Box paddingLeft={2} marginTop={1} flexDirection="column">
            <Input
              key={inputKey}
              label={editing ? '編輯' : '＋'}
              placeholder={editing ? '修改內容後按 Enter 儲存' : '新增備忘，按 Enter 加入（按 n 直接輸入）'}
              value={inputSeed}
              submitLabel={editing ? '儲存' : '加入'}
              onSubmit={value => void submitMemo($, value)}
            />
            {editing && (
              <Box flexDirection="row" gap={1}>
                <Text dimColor>正在編輯一筆備忘</Text>
                <Button key="memo-edit-cancel" plain dimColor label="取消編輯" onPress={() => cancelEdit($)} />
              </Box>
            )}
          </Box>
        ) : (
          empty('這個介面無法輸入文字，請在桌面版或終端機新增備忘')
        )}
        {memoNotice !== '' && (
          <Box paddingLeft={2}>
            <Text color="warning">{memoNotice}</Text>
          </Box>
        )}
        {lastRemoved && (
          <Box paddingLeft={2} flexDirection="row" gap={1}>
            <Text dimColor>{lastRemoved.label}</Text>
            <Button key="memo-undo" plain hotkey="u" onPress={() => void undoRemove($)}>
              <Text color="suggestion" bold>復原</Text>
            </Button>
          </Box>
        )}
        {openMemos.length === 0 && doneMemos.length === 0 && empty('還沒有備忘。記下待辦、提醒或要跟同事確認的事，只存在這台電腦。')}
        {openMemos.length === 0 && doneMemos.length > 0 && empty('待辦都完成了')}
        {openMemos.slice(0, limit).map(memoRow)}
        {moreRow(openMemos.length - Math.min(openMemos.length, limit))}
        {doneMemos.length > 0 && (
          <Box paddingLeft={2} marginTop={openMemos.length > 0 ? 1 : 0} flexDirection="row" gap={2}>
            <Button key="memo-done-toggle" plain onPress={() => { showDone = !showDone; redraw() }}>
              <Text dimColor>{`${showDone ? '▾' : '▸'} 已完成 ${doneMemos.length}`}</Text>
            </Button>
            <Button key="memo-clear-done" plain onPress={() => void clearDone($)}>
              <Text color="inactive" hover={{ color: 'error' }}>清除已完成</Text>
            </Button>
          </Box>
        )}
        {showDone && doneMemos.slice(0, showAll ? doneMemos.length : MEMO_DONE_SHOWN).map(memoRow)}
        {showDone && !showAll && doneMemos.length > MEMO_DONE_SHOWN && moreRow(doneMemos.length - MEMO_DONE_SHOWN)}
      </Box>
    )

    const milestoneCard = (m: Milestone) => {
      const total = m.open + m.closed
      const pct = total === 0 ? 0 : Math.round((m.closed / total) * 100)
      const mine = s.issues.filter(i => i.milestone === m.title)
      const shown = mine.slice(0, limit)
      const due = m.dueOn ? dueState(m.dueOn) : undefined
      const barWidth = Math.max(10, Math.min(30, inner - 22))
      const filled = Math.round((pct / 100) * barWidth)
      return (
        <Box
          key={`ms-${m.number}`}
          flexDirection="column"
          marginTop={1}
          paddingX={1}
          borderStyle="round"
          borderColor={pct >= 100 ? 'success' : 'claude'}
          borderDimColor={pct < 100}
        >
          <Box flexDirection="row" justifyContent="space-between">
            <Box flexDirection="row">
              {m.url ? (
                <Link href={m.url}>
                  <Text bold>{fit(m.title, Math.max(8, inner - 16))}</Text>
                </Link>
              ) : (
                <Text bold>{fit(m.title, Math.max(8, inner - 16))}</Text>
              )}
            </Box>
            {due && <Text color={due.color}>{due.text}</Text>}
          </Box>
          <Box flexDirection="row" marginTop={1}>
            <Text backgroundColor={BAR_DONE}>{' '.repeat(filled)}</Text>
            <Text backgroundColor={BAR_LEFT}>{' '.repeat(barWidth - filled)}</Text>
            <Text bold color={pctColor(pct)}>{` ${pct}%`}</Text>
            <Text dimColor>{`  ${m.closed}／${total} 完成`}</Text>
          </Box>
          {m.description && (
            <Box marginTop={1}>
              <Text dimColor italic wrap="truncate-end">
                {m.description}
              </Text>
            </Box>
          )}
          {mine.length > 0 && <Box marginTop={1} />}
          {shown.map(i => issueRow(i, 0))}
          {moreRow(mine.length - shown.length)}
        </Box>
      )
    }

    return (
      <Box flexDirection="column">
        {/* 工具列 */}
        <Box flexDirection="row" gap={1}>
          <Button
            key="refresh"
            variant="primary"
            label={s.isLoading ? '⟳ 更新中…' : '重新整理'}
            hotkey="r"
            onPress={() => void refresh($)}
          />
          <Button key="toggle" label={showAll ? '精簡' : '全部'} hotkey="a" onPress={() => { showAll = !showAll; redraw() }} />
          {Input && (
            <Button key="memo-new" label="新增備忘" hotkey="n" onPress={() => void focusMemoInput($)} />
          )}
          <Text dimColor>{s.fetchedAt ? `更新於 ${clock(s.fetchedAt)}` : '尚未更新'}</Text>
        </Box>

        {/* 專案卡 */}
        <Box flexDirection="column" marginTop={1} paddingX={1} borderStyle="round" borderColor="claude">
          <Box flexDirection="row" justifyContent="space-between">
            <Text bold>{s.repo ? fit(s.repo.name, Math.max(8, inner - 10)) : '（尚未取得 GitHub 資料）'}</Text>
            {s.repo && (
              <Link href={s.repo.url}>
                <Text color="suggestion">GitHub ↗</Text>
              </Link>
            )}
          </Box>
          <Box flexDirection="row" gap={2}>
            {s.branch && (
              <Text>
                <Text dimColor>分支 </Text>
                <Text color="permission">{s.branch}</Text>
              </Text>
            )}
            {s.dirty !== undefined &&
              (s.dirty > 0 ? chip(`● ${s.dirty} 個檔案未提交`, 'warning') : chip('● 工作區乾淨', 'success'))}
          </Box>
          <Box flexDirection="row" gap={2} marginTop={1}>
            <Text>
              <Text dimColor>里程碑 </Text>
              <Text bold>{String(counts.milestones)}</Text>
            </Text>
            <Text>
              <Text dimColor>Issue </Text>
              <Text bold>{String(s.issues.length)}</Text>
            </Text>
            <Text>
              <Text dimColor>PR </Text>
              <Text bold>{String(counts.prs)}</Text>
            </Text>
            <Text>
              <Text dimColor>備忘 </Text>
              <Text bold color={counts.memos > 0 ? 'warning' : undefined}>{String(counts.memos)}</Text>
            </Text>
          </Box>
        </Box>

        {s.error && (
          <Box marginTop={1} paddingX={1} borderStyle="round" borderColor="error">
            <Text color="error" wrap="wrap">
              {s.error}
            </Text>
          </Box>
        )}

        {/* 備忘錄（本機） */}
        {sectionHeader(SECTIONS[0]!)}
        {!collapsed.memos && memoSection}

        {/* 里程碑 */}
        {sectionHeader(SECTIONS[1]!)}
        {!collapsed.milestones && openMilestones.length === 0 && empty('沒有進行中的里程碑')}
        {!collapsed.milestones && openMilestones.map(milestoneCard)}
        {!collapsed.milestones && closedMilestones.length > 0 && (
          <Box paddingLeft={2} marginTop={1}>
            <Text dimColor wrap="truncate-end">{`已結束：${closedMilestones.map(m => m.title).join('、')}`}</Text>
          </Box>
        )}

        {/* 未排入里程碑的 Issue */}
        {sectionHeader(SECTIONS[2]!)}
        {!collapsed.issues && unassigned.length === 0 && empty('所有開啟中的 Issue 都已排入里程碑')}
        {!collapsed.issues && unassigned.slice(0, limit).map(i => issueRow(i, 2))}
        {!collapsed.issues && moreRow(unassigned.length - Math.min(unassigned.length, limit))}

        {/* PR */}
        {sectionHeader(SECTIONS[3]!)}
        {!collapsed.prs && s.prs.length === 0 && empty('沒有開啟中的 PR')}
        {!collapsed.prs && s.prs.map(prRow)}

        {/* 最近合併 */}
        {sectionHeader(SECTIONS[4]!)}
        {!collapsed.merged && s.merged.length === 0 && empty('沒有合併紀錄')}
        {!collapsed.merged && s.merged.slice(0, limit).map(mergedRow)}
        {!collapsed.merged && moreRow(s.merged.length - Math.min(s.merged.length, limit))}

        {/* 最近提交 */}
        {sectionHeader(SECTIONS[5]!)}
        {!collapsed.commits && s.commits.length === 0 && empty('沒有提交紀錄')}
        {!collapsed.commits && s.commits.slice(0, limit).map(commitRow)}
        {!collapsed.commits && moreRow(s.commits.length - Math.min(s.commits.length, limit))}

        <Box marginTop={1}>
          <Text dimColor>r 重新整理 · n 新增備忘 · u 復原刪除 · a 全部/精簡 · 0-5 展開/收合 · Esc 離開輸入框</Text>
        </Box>
      </Box>
    )
  })
}

// ---- 備忘錄操作：每次變更都立即寫入 $.store ----

async function saveMemos($: EngineInterface): Promise<void> {
  $.ui.invalidate('ui.render')
  if (!memoKey) return
  try {
    await $.store.set(memoKey, memos)
    memoNotice = ''
  } catch (err) {
    memoNotice = `備忘沒有存起來：${message(err)}`
    $.ui.invalidate('ui.render')
  }
}

/** 換一個新的輸入框（清空或帶入文字），並把焦點放回去。 */
async function resetInput($: EngineInterface, seed: string, focus: boolean): Promise<void> {
  inputSeed = seed
  inputGen += 1
  $.ui.invalidate('ui.render')
  if (focus) await focusMemoInput($)
}

async function focusMemoInput($: EngineInterface): Promise<void> {
  if (collapsed.memos) {
    collapsed = { ...collapsed, memos: false }
    $.ui.invalidate('ui.render')
  }
  try {
    await $.ui.focus({ requestId: PANE, key: `memo-input-${inputGen}` })
  } catch {
    // 面板沒拿到鍵盤時（例如焦點在對話框）就不搶焦點
  }
}

async function submitMemo($: EngineInterface, raw: string): Promise<void> {
  const text = raw.replace(/\s+/g, ' ').trim()
  if (editingId) {
    const id = editingId
    editingId = undefined
    if (text) memos = memos.map(m => (m.id === id ? { ...m, text } : m))
    // 編輯時清空送出等同取消，不刪除：刪除只走 ✕，才有復原。
  } else {
    if (!text) return
    if (memos.length >= MEMO_MAX) {
      memoNotice = `備忘最多 ${MEMO_MAX} 筆，請先清除已完成的項目`
      $.ui.invalidate('ui.render')
      return
    }
    memos = [...memos, { id: newId(), text, done: false, createdAt: Date.now() }]
  }
  lastRemoved = undefined
  await resetInput($, '', true)
  await saveMemos($)
}

function startEdit($: EngineInterface, m: Memo): void {
  editingId = m.id
  void resetInput($, m.text, true)
}

function cancelEdit($: EngineInterface): void {
  editingId = undefined
  void resetInput($, '', true)
}

async function toggleMemo($: EngineInterface, id: string): Promise<void> {
  memos = memos.map(m =>
    m.id === id ? (m.done ? { ...m, done: false, doneAt: undefined } : { ...m, done: true, doneAt: Date.now() }) : m,
  )
  await saveMemos($)
}

async function removeMemo($: EngineInterface, id: string): Promise<void> {
  const gone = memos.find(m => m.id === id)
  if (!gone) return
  memos = memos.filter(m => m.id !== id)
  if (editingId === id) {
    editingId = undefined
    await resetInput($, '', false)
  }
  lastRemoved = { items: [gone], label: `已刪除「${fit(gone.text, 20)}」` }
  await saveMemos($)
}

async function clearDone($: EngineInterface): Promise<void> {
  const done = memos.filter(m => m.done)
  if (done.length === 0) return
  memos = memos.filter(m => !m.done)
  lastRemoved = { items: done, label: `已清除 ${done.length} 筆已完成` }
  await saveMemos($)
}

async function undoRemove($: EngineInterface): Promise<void> {
  if (!lastRemoved) return
  const back = lastRemoved.items.filter(r => !memos.some(m => m.id === r.id))
  memos = [...memos, ...back].sort((a, b) => a.createdAt - b.createdAt)
  lastRemoved = undefined
  await saveMemos($)
}

function newId(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`
}

function isMemo(value: unknown): value is Memo {
  const m = value as Memo
  return typeof m === 'object' && m !== null && typeof m.id === 'string' && typeof m.text === 'string'
    && typeof m.done === 'boolean' && typeof m.createdAt === 'number'
}

/** 相對時間：剛剛、5 分、3 小時、2 天、超過一週給日期。 */
function ago(ms: number): string {
  const diff = Date.now() - ms
  if (diff < 60_000) return '剛剛'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小時`
  if (diff < 7 * 86_400_000) return `${Math.floor(diff / 86_400_000)} 天`
  return day(new Date(ms).toISOString())
}

async function refresh($: EngineInterface): Promise<void> {
  if (isRefreshing) return
  isRefreshing = true
  try {
    snapshot = { ...snapshot, isLoading: true, error: undefined }
    $.ui.invalidate('ui.render')

    const next: Snapshot = { ...EMPTY }
    const errors: string[] = []

    try {
      next.branch = (await run($, ['git', 'rev-parse', '--abbrev-ref', 'HEAD'])).trim()
      const status = await run($, ['git', 'status', '--porcelain'])
      next.dirty = status.split('\n').filter(l => l.trim()).length
      const log = await run($, ['git', 'log', '--oneline', '-10', '--no-decorate'])
      next.commits = parseLog(log)
    } catch (err) {
      errors.push(`git：${message(err)}`)
    }

    try {
      const repo = JSON.parse(await run($, ['gh', 'repo', 'view', '--json', 'nameWithOwner,url'])) as {
        nameWithOwner: string
        url: string
      }
      next.repo = { name: repo.nameWithOwner, url: repo.url }
      const [ms, issues, prs, merged] = await Promise.all([
        run($, ['gh', 'api', `repos/${repo.nameWithOwner}/milestones?state=all&per_page=100`]),
        run($, [
          'gh', 'issue', 'list', '--state', 'open', '--limit', '200',
          '--json', 'number,title,milestone,labels,updatedAt,url',
        ]),
        run($, [
          'gh', 'pr', 'list', '--state', 'open', '--limit', '50',
          '--json', 'number,title,headRefName,isDraft,reviewDecision,url',
        ]),
        run($, ['gh', 'pr', 'list', '--state', 'merged', '--limit', '10', '--json', 'number,title,mergedAt,url']),
      ])
      next.milestones = parseMilestones(ms)
      next.issues = parseIssues(issues)
      next.prs = parsePrs(prs)
      next.merged = parsePrs(merged)
    } catch (err) {
      errors.push(`GitHub：${message(err)}`)
    }

    next.fetchedAt = await $.clock.now()
    next.error = errors.length > 0 ? errors.join('；') : undefined
    next.isLoading = false
    snapshot = next
    $.ui.invalidate('ui.render')

    if (storeKey) {
      try {
        await $.store.set(storeKey, next)
      } catch {
        // 快取寫不進去不影響顯示
      }
    }
  } catch (err) {
    snapshot = { ...snapshot, isLoading: false, error: `更新失敗：${message(err)}` }
    $.ui.invalidate('ui.render')
  } finally {
    isRefreshing = false
  }
}

async function run($: EngineInterface, argv: readonly string[]): Promise<string> {
  const r = await $.process.run(argv, { timeoutMs: 60_000 })
  if (r.exitCode !== 0) {
    const first = (r.stderr || r.stdout).trim().split('\n')[0] ?? ''
    throw new Error(first || `${argv.join(' ')} 結束碼 ${r.exitCode}`)
  }
  return r.stdout
}

function parseLog(text: string): Commit[] {
  return text
    .split('\n')
    .filter(l => l.trim())
    .map(l => {
      const i = l.indexOf(' ')
      return i < 0 ? { sha: l, subject: '' } : { sha: l.slice(0, i), subject: l.slice(i + 1) }
    })
}

function parseMilestones(text: string): Milestone[] {
  const raw = JSON.parse(text) as Array<Record<string, unknown>>
  return raw
    .map(m => ({
      number: Number(m.number),
      title: String(m.title ?? ''),
      state: m.state === 'closed' ? ('closed' as const) : ('open' as const),
      open: Number(m.open_issues ?? 0),
      closed: Number(m.closed_issues ?? 0),
      dueOn: typeof m.due_on === 'string' ? m.due_on : undefined,
      description:
        typeof m.description === 'string' && m.description.trim() ? m.description.trim() : undefined,
      url: typeof m.html_url === 'string' ? m.html_url : undefined,
    }))
    .sort((a, b) => (a.dueOn ?? '9').localeCompare(b.dueOn ?? '9') || a.number - b.number)
}

function parseIssues(text: string): Issue[] {
  const raw = JSON.parse(text) as Array<Record<string, unknown>>
  return raw.map(i => {
    const ms = i.milestone as { title?: string } | null | undefined
    const labels: Label[] = Array.isArray(i.labels)
      ? (i.labels as Array<{ name?: string; color?: string }>).map(l => ({
          name: String(l.name ?? ''),
          color: typeof l.color === 'string' && /^[0-9a-fA-F]{6}$/.test(l.color) ? l.color : undefined,
        }))
      : []
    return {
      number: Number(i.number),
      title: String(i.title ?? ''),
      milestone: ms && typeof ms.title === 'string' ? ms.title : undefined,
      labels,
      updatedAt: String(i.updatedAt ?? ''),
      url: typeof i.url === 'string' ? i.url : undefined,
    }
  })
}

function parsePrs(text: string): Pr[] {
  const raw = JSON.parse(text) as Array<Record<string, unknown>>
  return raw.map(p => ({
    number: Number(p.number),
    title: String(p.title ?? ''),
    branch: typeof p.headRefName === 'string' ? p.headRefName : undefined,
    isDraft: p.isDraft === true,
    review: typeof p.reviewDecision === 'string' ? p.reviewDecision : undefined,
    mergedAt: typeof p.mergedAt === 'string' ? p.mergedAt : undefined,
    url: typeof p.url === 'string' ? p.url : undefined,
  }))
}

function reviewTag(review: string | undefined): { text: string; color: string } | undefined {
  switch (review) {
    case 'APPROVED':
      return { text: '✓ 已核准', color: 'success' }
    case 'CHANGES_REQUESTED':
      return { text: '✗ 要求修改', color: 'error' }
    case 'REVIEW_REQUIRED':
      return { text: '◌ 待審', color: 'warning' }
    default:
      return undefined
  }
}

function commitKind(subject: string): { raw: string; text: string; color: string } | undefined {
  const m = /^(\w+)(\([^)]*\))?(!)?:/.exec(subject)
  if (!m) return undefined
  const type = m[1]!.toLowerCase()
  const colors: Record<string, string> = {
    feat: 'success',
    fix: 'error',
    docs: 'suggestion',
    refactor: 'warning',
    perf: 'warning',
    test: 'permission',
    chore: 'inactive',
    build: 'inactive',
    ci: 'inactive',
    style: 'inactive',
    infra: 'inactive',
  }
  return { raw: m[0], text: m[0], color: colors[type] ?? 'text' }
}

function labelColor(l: Label): string {
  return l.color ? `#${l.color}` : 'inactive'
}

function pctColor(pct: number): string {
  if (pct >= 100) return 'success'
  if (pct >= 50) return 'claude'
  if (pct > 0) return 'warning'
  return 'inactive'
}

function dueState(iso: string): { text: string; color: string } {
  const due = new Date(iso)
  if (Number.isNaN(due.getTime())) return { text: iso.slice(0, 10), color: 'inactive' }
  const days = Math.ceil((due.getTime() - Date.now()) / 86_400_000)
  if (days < 0) return { text: `逾期 ${-days} 天`, color: 'error' }
  if (days <= 7) return { text: `${days} 天後到期`, color: 'warning' }
  return { text: `到期 ${day(iso)}`, color: 'inactive' }
}

/** 終端機裡 CJK 佔兩格；用來估算一行能放多少字。 */
function cells(text: string): number {
  let n = 0
  for (const ch of text) {
    const c = ch.codePointAt(0) ?? 0
    n +=
      (c >= 0x1100 && c <= 0x115f) ||
      (c >= 0x2e80 && c <= 0xa4cf) ||
      (c >= 0xac00 && c <= 0xd7a3) ||
      (c >= 0xf900 && c <= 0xfaff) ||
      (c >= 0xfe30 && c <= 0xfe4f) ||
      (c >= 0xff00 && c <= 0xff60) ||
      (c >= 0xffe0 && c <= 0xffe6) ||
      (c >= 0x20000 && c <= 0x3fffd)
        ? 2
        : 1
  }
  return n
}

function fit(text: string, maxCells: number): string {
  if (cells(text) <= maxCells) return text
  let out = ''
  let used = 0
  for (const ch of text) {
    const w = cells(ch)
    if (used + w > maxCells - 1) break
    out += ch
    used += w
  }
  return out + '…'
}


function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n)
}

function clock(ms: number): string {
  const d = new Date(ms)
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function day(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10)
  return `${pad(d.getMonth() + 1)}/${pad(d.getDate())}`
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

function isSnapshot(value: unknown): value is Snapshot {
  return (
    typeof value === 'object' &&
    value !== null &&
    Array.isArray((value as Snapshot).milestones) &&
    Array.isArray((value as Snapshot).issues)
  )
}

