export type Milestone = {
  number: number
  title: string
  state: 'open' | 'closed'
  open: number
  closed: number
  dueOn?: string
  description?: string
  url?: string
}

export type Label = { name: string; color?: string }

export type Issue = {
  number: number
  title: string
  milestone?: string
  labels: Label[]
  updatedAt: string
  url?: string
}

export type Pr = {
  number: number
  title: string
  branch?: string
  isDraft?: boolean
  review?: string
  mergedAt?: string
  url?: string
}

export type Commit = { sha: string; subject: string }

export type Snapshot = {
  repo?: { name: string; url: string }
  branch?: string
  dirty?: number
  commits: Commit[]
  milestones: Milestone[]
  issues: Issue[]
  prs: Pr[]
  merged: Pr[]
  fetchedAt?: number
  error?: string
  isLoading: boolean
}

export type SectionId = 'memos' | 'milestones' | 'issues' | 'prs' | 'merged' | 'commits'

/** 本機備忘：依專案（工作目錄）存在 Claude Code 的 plugin store，不碰 repo 與 GitHub。 */
export type Memo = {
  id: string
  text: string
  done: boolean
  createdAt: number
  doneAt?: number
}

/** 多 repo 模式下，工作目錄底下的一個 GitHub repo。 */
export type RepoRef = {
  /** 子資料夾名稱，相對於工作目錄 */
  dir: string
  /** GitHub 的 owner/name */
  slug: string
  /** 切換列上顯示的短名稱 */
  label: string
}

/** 工作目錄本身不是 git repo、底下有多個 repo 時，偵測到的 repo 清單。 */
export type Workspace = {
  repos: RepoRef[]
  selected?: string
}
