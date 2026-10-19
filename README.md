# project-progress

A [Claude Code](https://claude.com/claude-code) mod that opens a **project progress pane** beside your conversation, built automatically from your repo's GitHub data and git history. Nothing to type in by hand.

- **Milestones** with a progress bar, completion percentage, due date (overdue in red, due within a week in orange) and the open issues under each
- **Open issues** not yet assigned to a milestone, with labels in their GitHub colors
- **Open PRs** with draft and review status
- **Recently merged PRs** and **recent commits**, commit types colored by conventional-commit prefix
- **Memos**: a local, per-project to-do list you type into the pane. Check items off, click one to edit it, ✕ to delete with undo. Stored only on this machine, never in the repo or on GitHub. Claude can read and add memos too, through the mod's `memo` tool
- Issue, PR and milestone numbers are clickable links
- **Multi-repo workspaces**: open it in a folder that holds several repos and it shows each one, with a switcher on top

Works in the terminal and in the Claude Desktop app's Code tab. UI text is in Traditional Chinese (繁體中文); see [中文說明](#中文說明) below.

![The project-progress pane docked in the Claude Desktop Code tab: repo card, a milestone with its progress bar and issues, and unassigned issues](assets/pane-desktop.png)

*The pane in the Claude Desktop Code tab. Repo name, milestone and issue titles are blanked out in this screenshot.*

## Requirements

- Claude Code **2.1.287 or newer** (tested on 2.1.295). The mod API is early access and may change between releases.
- [`gh`](https://cli.github.com/) installed and logged in (`gh auth login`), with access to the repo you are working in
- `git`
- The working directory must be either a git repo with a GitHub remote, or a folder whose direct subfolders are such repos (see [Multi-repo workspaces](#multi-repo-workspaces)). With neither, the git sections still render and the GitHub section shows the error.

## Install

```sh
claude plugin marketplace add RexWei1016/claude-project-progress
claude plugin install project-progress@claude-project-progress
```

In an already-running session run `/reload-plugins`, then:

```
/project-progress
```

In the Desktop app the command does not appear in the slash-command typeahead; type the full name and press Enter.

To try the source without installing:

```sh
git clone https://github.com/RexWei1016/claude-project-progress
claude --plugin-dir ./claude-project-progress
```

## Using the pane

| Key / control | Action |
| --- | --- |
| `r` or **重新整理** | Refresh now |
| `n` or **新增備忘** | Jump into the memo field; type, then Enter to add |
| `u` or **復原** | Undo the last memo delete or "clear completed" |
| `a` or **全部 / 精簡** | Show all rows / show the first 6 of each list |
| `0` – `5` or click a section title | Collapse / expand that section (`0` is memos) |
| `s` or **下一個 repo**, or click a repo tab | Switch to another repo (multi-repo workspaces only) |
| Esc | Leave the memo field; again to close the pane (`/project-progress` reopens it) |

Keys reach the pane while it has focus (click it, or `ctrl+x tab` in the terminal). While the pane is open it refreshes every 10 minutes.

## Multi-repo workspaces

When the session's working directory is not itself inside a git repo, the pane looks at its direct subfolders. Every subfolder that is a git repo with a GitHub remote (`origin` first, otherwise the first GitHub remote) becomes a tab in a row above the repo card; the rest of the pane shows the selected repo exactly as in single-repo mode, plus the folder it reads from.

```
Workspace/
├── Acme.WebAPI.Shop/   → tab "WebAPI"
├── Acme.WebUI.Shop/    → tab "WebUI"
├── Acme.PdaApp.Shop/   → tab "PdaApp"
├── _pr12/              (another clone of Acme.PdaApp.Shop: not a separate tab)
└── docs/               (not a git repo: ignored)
```

- Tab names drop the dotted prefix and suffix all repo names share (`Acme.WebAPI.Shop` → `WebAPI`); if that would leave names empty or identical, the full repo names are used.
- Several clones of the same GitHub repo collapse into one tab. The folder named exactly like the repo wins, then one not starting with `_` or `.`.
- Refresh reads every repo at once; a tab shows `⟳` while it loads and `!` when it hit an error.
- Nested folders are not searched, only direct subfolders. A working directory that is a repo always gets single-repo mode, as before.

## How it works and what it touches

- Reads data with `gh repo view`, `gh api .../milestones`, `gh issue list`, `gh pr list`, `git rev-parse`, `git status --porcelain` and `git log`, all run through the mod API's `$.process.run` in the session's working directory. In a multi-repo workspace it also lists the subfolders (`$.fs.list`, `$.fs.exists`) and reads each one's remotes with `git config --get-regexp`; git then runs in each subfolder and `gh` is given `--repo owner/name`.
- Never writes to the repo or to GitHub. The only network traffic is `gh` talking to GitHub as you.
- Caches the last snapshot per working directory in Claude Code's local plugin store, and in a multi-repo workspace one per repo plus the repo list and the selected tab, so the pane shows data immediately on the next session while it refreshes.
- Memos live in the same local store, one list per working directory (a multi-repo workspace shares one list across its repos), saved on every change (up to 300 per project). The mobile app shows them but cannot add any, as it draws no text field.

## Development

```sh
claude plugin validate .
```

Edit `hooks/register.tsx`; a session started with `--plugin-dir` hot-reloads on save. Type-check against the declarations the engine lays in `.claude-plugin/types/` after the first load with `tsc -p .`.

Tests in `test/` run against the engine with mocked `git`, `gh` and file system:

```sh
claude plugin test .
```

## 中文說明

這是一個 Claude Code mod，在對話旁開一個「專案進度」面板，內容從目前 repo 的 GitHub 資料與 git 歷史自動產生：

- 里程碑：進度條、完成百分比、到期日（逾期紅色、一週內橘色）、底下的開啟 Issue
- 未排入里程碑的 Issue，標籤用 GitHub 設定的顏色
- 進行中的 PR（草稿、審核狀態）
- 最近合併的 PR 與最近提交（依 feat／fix／docs 等前綴上色）
- 備忘錄：每個專案一份的本機待辦，直接在面板輸入。勾選完成、點文字編輯、✕ 刪除可復原。只存在這台電腦，不寫進 repo 也不上 GitHub。Claude 也能透過 mod 提供的 `memo` 工具讀取與新增備忘
- 編號都是可以點的連結

需要先安裝並登入 `gh`，工作目錄必須是有 GitHub remote 的 git repo，或是底下直接放著多個這種 repo 的資料夾。安裝指令同上；安裝後在 session 裡輸入 `/project-progress`。按 `r` 重新整理、`n` 新增備忘、`u` 復原刪除、`a` 切換全部／精簡、`0` 到 `5` 收合或展開各區塊（`0` 是備忘錄）；在輸入框裡按 Esc 離開輸入框，再按一次關閉面板。

### 多 repo 工作區

工作目錄本身不在 git repo 裡時，面板會檢查它的直接子資料夾：每個有 GitHub remote（優先用 `origin`）的 git repo 都會變成上方切換列的一個分頁，點分頁或按 `s` 切換；下面的內容跟單一 repo 模式一樣，另外會標出讀取的資料夾。備忘錄跟著工作目錄走，各 repo 分頁共用同一份。

- 分頁名稱會去掉所有 repo 名稱共同的點號前綴與後綴（`Acme.WebAPI.Shop` → `WebAPI`）；去掉後若變成空字串或重複，就用完整名稱。
- 同一個 GitHub repo 的多份 clone 只顯示一個分頁：資料夾名稱跟 repo 同名者優先，其次是不以 `_` 或 `.` 開頭的。
- 重新整理會同時讀取所有 repo；讀取中的分頁顯示 `⟳`，出錯的顯示 `!`。
- 只看直接子資料夾，不會往下層找。工作目錄本身是 repo 時一律是原本的單一 repo 模式。
- 一樣只執行唯讀的 `git`／`gh` 指令：git 在各子資料夾執行，`gh` 用 `--repo owner/name` 指定 repo。快照依工作目錄與 repo 分別快取。

## License

MIT
