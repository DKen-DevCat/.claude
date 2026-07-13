---
name: phase-resume
description: phase registry / tasks / git / MEMORY を照合して現在のフェーズと未完タスクを復元し、次の 3 アクションを提案する
---

# /phase-resume

作業を再開する際、現在地を素早く把握するための **読み取り専用** コマンド。
プロジェクト固有のパスは `CLAUDE.md` の `## Skills config` 見出し直下の最初の ```yaml フェンスから読み取る。

> 棲み分け: 自律実装は `/goal:exec-v5`（正本）が担う。phase-* は人間駆動の手動フェーズ運用トラックであり、phase-resume はそのトラックの現在地復元（読み取り専用）を担う。

## 設定読み取り（先頭で一度だけ）

CLAUDE.md は自動ロードされている。文脈中の `## Skills config` 見出し直下の最初の ```yaml フェンス内 YAML を参照して以下を確定する。
キーが無ければ既定値を使う:

| キー | 既定値 |
|---|---|
| `phase.phase_registry` | `.claude/plan.md` |
| `phase.tasks_file` | `.claude/tasks.md` |
| `phase.tasks_archive_dir` | `.claude/tasks-archive` |

config ブロック自体が存在しない PJ では、上記既定値で動作する旨をユーザーに 1 行で通知してから続行する。

## 実行ステップ

1. `{{phase.phase_registry}}` を Read し、直近のフェーズ名とステータスを抽出する
2. `{{phase.tasks_file}}` を Read し、`- [ ]` で始まる未完タスクを列挙する（最大 15 件、超過分は「他 N 件」と省略）
3. 以下 3 本を **単一メッセージ内で並列 Bash 実行**:
   - `git log --oneline -10`
   - `git status --short`
   - `git branch --show-current`
4. セッション起動時に system-reminder で読み込まれている MEMORY.md の内容（プロジェクト状態・フェーズ進捗の記述）を参照する
5. 実状況（tasks ファイル + git）と MEMORY の記述を照合し、ズレがあれば警告する
6. ブランチ名と未完タスクから、**次に着手すべき 3 件**を推定して提案する

## 出力フォーマット

```markdown
### Phase resume

- Current branch: <branch>
- Phase (from {{phase.phase_registry}}): <name / status>
- Memory says: <requirement progress summary>

### Recent commits

<git log --oneline -10 の出力>

### Working tree status

<git status --short の出力、空なら "clean">

### Unfinished tasks (from {{phase.tasks_file}})

- [ ] ...
- [ ] ...
（最大 15 件 / 超過分は「他 N 件」と省略）

### Suggested next 3 actions

1. ...
2. ...
3. ...

### ⚠ Inconsistencies

<あれば記載、無ければ "None">
```

## 制約

- このコマンドは **読み取り専用**。ファイル修正・commit は一切しない
- 次アクションの提案は、ユーザーがそれを選ぶ・却下する前提で出す（自動実行しない）
- MEMORY.md は system-reminder 経由で読み込まれるため、直接 Read する必要はない
- アーカイブされたタスク（`{{phase.tasks_archive_dir}}/**`）は読まない（現行フェーズにフォーカス）
- `{{phase.phase_registry}}` または `{{phase.tasks_file}}` が存在しない PJ では、欠落を明示してから読める範囲だけサマリする
