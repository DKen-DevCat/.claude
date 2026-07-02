---
name: phase-kickoff
description: 次フェーズのブランチ + 設計ドキュメント + tasks 進行中セクションを作成し、キックオフコミットを切る
---

# /phase-kickoff

フェーズ作業を開始するときの定型作業を固定化する。
Step1 で現状確認（`/phase-resume` 相当の軽量版を自前 git + Read で実施）→ ブランチ作成 → 設計雛形 → tasks 更新 → コミット までを 1 コマンドで。

> 棲み分け: 自律実装は `/goal:exec-v5`（正本）が担う。phase-* は人間駆動の手動フェーズ運用トラックであり、phase-kickoff はそのトラックのフェーズ開始（ブランチ + design + tasks + キックオフコミット）を担う。

## 設定読み取り（先頭で一度だけ）

CLAUDE.md は自動ロードされている。文脈中の `## Skills config` 見出し直下の最初の ```yaml フェンス内 YAML を参照して以下を確定する。
キーが無ければ既定値を使う:

| キー | 既定値 |
|---|---|
| `phase.base_branch` | `develop` |
| `phase.branch_pattern` | `feat/{phase-id}-{slug}` |
| `phase.phase_registry` | `.claude/plan.md` |
| `phase.tasks_file` | `.claude/tasks.md` |
| `phase.design_dir` | `.claude/design` |
| `phase.design_filename_pattern` | `<slug>-<YYYY-MM-DD>.md` |
| `phase.commit_msg_hook_requires_tasks` | `true` |

`branch_pattern` のトークンは `{phase-id}`（フェーズID）と `{slug}`（フェーズ概要の kebab-case スラグ）で、skill が実値へ置換して補間する（例: `feat/{phase-id}-{slug}` → `feat/S5-live-preview`）。

config ブロック自体が無い PJ では、上記既定値で動作する旨をユーザーに 1 行で通知してから続行する。

## 引数

- `<フェーズ名>` （省略可）: `S5`, `R4`, `chore-lint-cleanup` など。省略時は registry / tasks から次フェーズを推定する
- `--from <ベースブランチ>` （省略可、既定 `{{phase.base_branch}}`）: ブランチを切る起点
- `--branch <ブランチ名>` （省略可）: 命名を上書き。既定は `{{phase.branch_pattern}}` を埋めた値

## 実行ステップ

### Step 1. 現状確認

以下を **単一メッセージ内で並列 Bash 実行**:

- `git status --short`
- `git branch --show-current`
- `git log --oneline -5`
- `git fetch origin --prune`

`{{phase.phase_registry}}` と `{{phase.tasks_file}}` を Read。

引数が省略されている場合:
- registry のフェーズ一覧と tasks の `- [ ]` 未完を突き合わせ、**未着手のうち番号が最小**のフェーズを次の対象として提案
- ユーザーに 1 行で確認（「Phase X を起点として進めて良いか？」）

### Step 2. ベースブランチに切替えて最新化

```
git checkout {{phase.base_branch}}
git pull --ff-only origin {{phase.base_branch}}
```

`fast-forward 不可` のときは中断し、ユーザーに状況を報告する（強制更新は禁止）。

### Step 3. 作業ブランチ作成

ブランチ名:
- `--branch` 指定があれば優先
- なければ `{{phase.branch_pattern}}` を埋めた値（slug はフェーズ概要から ASCII 30 文字まで kebab-case）
- 既存ブランチが存在する場合は中断し、ユーザーに `--branch` で別名指定を促す

```
git checkout -b <branch>
```

### Step 4. 設計ドキュメント雛形作成

`{{phase.design_dir}}/{{phase.design_filename_pattern}}` を Write する。`<slug>` `<YYYY-MM-DD>` を埋めた値を使う。

```markdown
---
phase: <phase-id>
title: <フェーズ概要>
date: <YYYY-MM-DD>
branch: <branch>
base: {{phase.base_branch}} @ <SHA>
status: draft
---

# Phase <phase-id>: <タイトル>

## 目的

<フェーズの狙い、コアバリューとの関係>

## スコープ

| # | 項目 | 主対象ファイル | 備考 |
|---|---|---|---|
| <id-1> | <項目> | <path> | <備考> |

## 実装方針

<共通方針 / TDD ヘルパーの分割案 / リスクなど>

## テスト方針

<対象 / レイヤー>

## 完了条件

- 全テスト PASS
- 型チェック / lint / ビルドクリーン
- 手動確認: <内容>

## コミット粒度

1 機能 1 コミット原則。設計とテストを先に出すコミットも分ける。
本ドキュメント + tasks 更新を本ブランチのキックオフコミットとする。

## リスク・未決事項

- <要確認の点>
```

`<base SHA>` は `git rev-parse --short {{phase.base_branch}}` で取得した値を埋める。

### Step 5. tasks 進行中セクション追加

`{{phase.tasks_file}}` の末尾に下記を append（既存末尾の `## Phase ...` の後ろに `---` 区切りで追加）:

```markdown

---

## Phase <phase-id>: <タイトル> — 進行中

ブランチ: `<branch>`（{{phase.base_branch}} @ `<SHA>` 起点）

設計: [`{{phase.design_dir}}/<埋めたファイル名>`](<相対 path>)

<registry の該当セクションから抜粋した未完項目を `- [ ]` で並べる>
```

registry にフェーズ未定義の場合は、ユーザーに項目をヒアリングしてから書き起こす（**仮定で書かない**）。

### Step 6. キックオフコミット

```
git add <design ファイルパス> {{phase.tasks_file}}
git commit -m "docs(<phase-id>): kickoff Phase <phase-id> <title> — design + tasks"
```

`commit_msg_hook_requires_tasks: true` の PJ では tasks ファイル更新が含まれているため hook を満たす。
`false` の PJ では hook を考慮せずそのままコミット。

### Step 7. 結果サマリ

```markdown
### Phase kickoff result

- Phase: <phase-id>
- Branch: <branch>
- Base: {{phase.base_branch}} @ <SHA>
- Created files:
  - `<design ファイルパス>`
  - `{{phase.tasks_file}}` 更新
- Initial commit: <oid> docs(<phase-id>): kickoff ...

### Next steps

1. 設計ドキュメントを Read して内容を肉付けする
2. 実装を 1 機能 1 コミットで進める
3. 完了後 `/phase-ship` で `/check` → push → PR → review サイクル
```

## 制約

- **push しない / PR を作らない** — それは `/phase-ship` の責務
- フェーズ ID が registry に未記載の場合は、勝手に決めず必ずユーザーに確認する
- ベースブランチが汚染されている（uncommitted changes）場合は中断し、ユーザーに stash / commit を促す
- 既存ブランチに同名がある場合は中断（強制上書きしない）
- 設計テンプレートに含まれるレイヤー名（FE / BE / DB / Infra など）は PJ により調整可。registry の該当エントリの「影響範囲」表に従って書き起こす
