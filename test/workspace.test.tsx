import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

const PANE = {
  component: 'Pane',
  requestId: 'project-progress',
  props: {
    title: '專案進度',
    isFocused: true,
    bodyColumns: 80,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 40 },
    view: {},
  },
} as const

type Call = { argv: readonly string[]; cwd?: string }

const ok = (stdout: string) => ({
  value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
})
const fail = (stderr: string) => ({
  value: { exitCode: 128, stdout: '', stderr, isStdoutTruncated: false, isStderrTruncated: false },
})

/** 假的工作區：根目錄不是 repo，底下三個 repo、一份重複 clone、一個非 repo 資料夾。 */
const DIRS: Record<string, string | undefined> = {
  'Barwand.WebAPI.CoupangWMS': 'https://github.com/acme/Barwand.WebAPI.CoupangWMS.git',
  'Barwand.WebUI.CoupangWMS': 'git@github.com:acme/Barwand.WebUI.CoupangWMS.git',
  'Barwand.PdaApp.CoupangWMS': 'https://github.com/acme/Barwand.PdaApp.CoupangWMS.git',
  _pr2: 'https://github.com/acme/Barwand.PdaApp.CoupangWMS.git',
  apk: undefined,
}

function fakeWorld(on: On, opts: { rootIsRepo: boolean }): Call[] {
  const calls: Call[] = []
  mock.clock(on, { now: Date.UTC(2026, 9, 17) })
  mock.store(on)
  // 引擎把相對路徑解析成絕對路徑後才交給下層，所以這裡只看最後一段
  const base = (path: string) => path.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? path
  on('fs.list', () => ({
    value: Object.keys(DIRS).map(name => ({ name, kind: 'dir' as const, size: 0, mtimeMs: 0, isLink: false })),
  }))
  on('fs.exists', (_$, e) => ({ value: DIRS[base(e.path.replace(/[\\/]\.git$/, ''))] !== undefined }))
  on('process.run', (_$, e) => {
    const argv = e.argv
    const cwd = e.init?.cwd === undefined ? undefined : base(e.init.cwd)
    calls.push({ argv, cwd })
    const cmd = argv.join(' ')
    if (cmd === 'git rev-parse --is-inside-work-tree') {
      return cwd === undefined && opts.rootIsRepo ? ok('true\n') : fail('fatal: not a git repository')
    }
    if (argv[0] === 'git' && argv[1] === 'config') {
      const url = cwd ? DIRS[cwd] : undefined
      return url ? ok(`remote.origin.url ${url}\n`) : fail('')
    }
    if (cmd === 'git rev-parse --abbrev-ref HEAD') return ok(`branch-of-${cwd ?? 'root'}\n`)
    if (cmd === 'git status --porcelain') return ok('')
    if (argv[0] === 'git' && argv[1] === 'log') return ok(`abc1234 feat: commit in ${cwd ?? 'root'}\n`)
    if (argv[0] === 'gh' && argv[1] === 'repo') {
      const slug = argv[3] && !argv[3].startsWith('--') ? argv[3] : 'acme/single'
      return ok(JSON.stringify({ nameWithOwner: slug, url: `https://github.com/${slug}` }))
    }
    if (argv[0] === 'gh' && argv[1] === 'api') return ok('[]')
    if (argv[0] === 'gh' && argv[1] === 'issue') {
      const i = argv.indexOf('--repo')
      const slug = i >= 0 ? argv[i + 1]! : 'acme/single'
      return ok(JSON.stringify([{ number: 7, title: `issue of ${slug}`, milestone: null, labels: [], updatedAt: '', url: '' }]))
    }
    if (argv[0] === 'gh' && argv[1] === 'pr') return ok('[]')
    return fail(`unexpected: ${cmd}`)
  })
  return calls
}

test('多 repo 工作區：每個 GitHub repo 一個分頁，重複 clone 只留一份', async ($, on) => {
  const calls = fakeWorld(on, { rootIsRepo: false })
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'project-progress', surface, ...PANE })
    await ui.press({ key: 'refresh' })

    const tabs = (await ui.findAll({ type: 'Button' })).filter(b => b.key?.startsWith('repo-'))
    expect(tabs.map(t => t.key)).toEqual([
      'repo-Barwand.PdaApp.CoupangWMS',
      'repo-Barwand.WebAPI.CoupangWMS',
      'repo-Barwand.WebUI.CoupangWMS',
    ])
    expect(tabs.map(t => t.props.label)).toEqual(['PdaApp', 'WebAPI', 'WebUI'])
    expect(await ui.find({ text: /issue of acme\/Barwand\.PdaApp\.CoupangWMS/ })).toBeDefined()

    await ui.press({ key: 'repo-Barwand.WebUI.CoupangWMS' })
    expect(await ui.find({ text: /issue of acme\/Barwand\.WebUI\.CoupangWMS/ })).toBeDefined()
    expect(await ui.find({ text: /branch-of-Barwand\.WebUI\.CoupangWMS/ })).toBeDefined()

    await ui.press({ key: 'next-repo' })
    expect(await ui.find({ text: /issue of acme\/Barwand\.PdaApp\.CoupangWMS/ })).toBeDefined()
    await ui.unmount()
  }

  // gh 一律帶 --repo；git 在子資料夾執行；重複 clone 與非 repo 資料夾不會被查
  const issueCalls = calls.filter(c => c.argv[0] === 'gh' && c.argv[1] === 'issue')
  expect(issueCalls.every(c => c.argv.includes('--repo'))).toBe(true)
  const gitDirs = new Set(calls.filter(c => c.argv[1] === 'log').map(c => c.cwd))
  expect([...gitDirs].sort()).toEqual([
    'Barwand.PdaApp.CoupangWMS',
    'Barwand.WebAPI.CoupangWMS',
    'Barwand.WebUI.CoupangWMS',
  ])
})

test('單一 repo：行為跟以前一樣，不顯示 repo 切換列', async ($, on) => {
  const calls = fakeWorld(on, { rootIsRepo: true })
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'project-progress', surface, ...PANE })
    await ui.press({ key: 'refresh' })
    const tabs = (await ui.findAll({ type: 'Button' })).filter(b => b.key?.startsWith('repo-'))
    expect(tabs).toHaveLength(0)
    expect(await ui.find({ key: 'next-repo' })).toBeUndefined()
    expect(await ui.find({ text: /issue of acme\/single/ })).toBeDefined()
    await ui.unmount()
  }
  const work = calls.filter(c => c.argv.join(' ') !== 'git rev-parse --is-inside-work-tree')
  expect(work.every(c => c.cwd === undefined && !c.argv.includes('--repo'))).toBe(true)
})
