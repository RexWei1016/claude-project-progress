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

export type SectionId = 'milestones' | 'issues' | 'prs' | 'merged' | 'commits'
