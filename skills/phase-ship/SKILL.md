---
name: phase-ship
description: 実装済みブランチを /check → push → PR 作成（or 反映）→ /phase-review --fix → /dev-restart 動作確認案内 → push まで一気通貫
---

# /phase-ship

フェーズ作業をクローズするための定型作業を固定化する。
**修正の採否はユーザー承認**を必ず挟む（自動コミット禁止）。

> 棲み分け: 自律実装は `/goal:exec-v5`（正本）が担い、そのまま draft PR まで無人で自走する。phase-* は人間駆動の手動フェーズ運用トラックであり、phase-ship はそのトラックの ship（クローズ）工程を担う。

## 設定読み取り（先頭で一度だけ）

CLAUDE.md は自動ロードされている。文脈中の `## Skills config` 見出し直下の最初の ```yaml フェンス内 YAML を参照して以下を確定する。
キーが無ければ既定値を使う:

| キー | 既定値 |
|---|---|
| `phase.base_branch` | `develop` |
| `phase.design_dir` | `.claude/design` |

config ブロック自体が無い PJ では、上記既定値で動作する旨をユーザーに 1 行で通知してから続行する。

## 引数

- `--skip-review` : `/phase-review` をスキップして push のみ
- `--no-restart` : 修正後のサーバー再起動による動作確認案内をスキップ
- `--draft` : PR を draft で作成

## 実行ステップ

### Step 1. ブランチと差分の確認

`git status --short` / `git branch --show-current` / `git log --oneline {{phase.base_branch}}..HEAD` を **単一メッセージ内で並列 Bash 実行**。

- 未コミット変更があれば中断し、ユーザーに `git commit` を促す
- 現在ブランチが `{{phase.base_branch}}` / `main` / `master` の場合は中断（ship 対象として不適切）
- `{{phase.base_branch}}` から差分がない場合は中断

### Step 2. /check を起動

`/check` スキルをランタイム起動して結果を待つ。1 件でも FAIL なら中断（push しない）。
**インラインで PJ 固有の検証コマンドを書かない**（PJ 固有の検証は `/check` 側に閉じ込める）。

### Step 3. push（必要なら upstream 設定）

`git push` を実行。upstream 未設定の場合は `git push -u origin <branch>`。

`fast-forward 不可` のときは中断（強制 push 禁止）。

### Step 4. PR 作成 or 既存 PR の検出

`gh pr list --head <branch> --json number,state,url --limit 1` で既存 PR を確認。

- 存在しない & state OPEN がない場合 → `gh pr create` を実行（base は `{{phase.base_branch}}`、`--draft` 引数があれば draft で）
  - title: 直近のフィーチャーコミットの `<type>(<scope>): <subject>` 形式を継承
  - body: `{{phase.design_dir}}` 配下の最新 design ドキュメント（ブランチ名 / フェーズ ID から推定、無ければ単純に最新更新ファイル）の `## 目的` `## スコープ` `## 完了条件` を抽出 + 完了条件チェック結果 + Test plan セクション
- 存在する場合 → push のみで反映完了。PR # を控える

### Step 5. レビュー & 修正（`--skip-review` でない場合）

`/phase-review --fix` を起動して結果を待つ。**`--pr` は渡さない**（ship は既に head ブランチに居るため PR 番号は不要。phase-review は `--pr` + `--fix` の同時指定を禁止しており、渡すと phase-review が即中断する）。phase-review は内部で `phase.review_cmd`（既定 `/code-review`）を起動する。

`/phase-review --fix` が内部で次を完結させる:
- 並列レビュー → 統合 → TaskCreate 採否提案 → ユーザー承認 → Edit 修正 → tasks 更新（hook 必要時のみ）→ `/check` → コミット

採用 0 件 / ユーザー中断などでコミットが作られなかった場合は、Step 6 をスキップして Step 7 へ進む。

### Step 6. push（修正コミットを PR に反映）

`/phase-review --fix` が新しいコミットを作っていれば `git push` でリモートへ反映する。
`fast-forward 不可` のときは中断（強制 push 禁止）。

### Step 7. 動作確認案内（`--no-restart` でない場合）

ユーザーに「動作確認のためにサーバー再起動が必要なら `/dev-restart` を叩いてください」と案内する。
**自動再起動はしない**（既存セッションへの影響を避けるため）。

`/dev-restart` が PJ ローカルにない場合（config の `skills.dev_restart` が `local` 以外、または存在しない場合）は、案内自体をスキップする。

### Step 8. 結果サマリ

```markdown
### Phase ship result

- PR: #<番号> (<url>)
- /check: PASS（<`/check` の結果サマリ>）
- /phase-review: <採用件数> / <統合件数> 件対応 | skip
- 反映コミット: <oid> ... | 反映なし
- 動作確認: `/dev-restart` 案内 | skip

### CI 状態

<gh pr view <番号> --json statusCheckRollup の要約>
```

## 制約

- **自動コミット禁止**。`/phase-review --fix` 側でも必ずユーザー承認を挟む
- **強制 push 禁止**（fast-forward 不可なら中断）
- 既に閉じた PR には反映しない（OPEN 状態のみ対象）
- 既存ブランチ → 既存 PR の場合、新規 PR は作らず push のみ
- `--skip-review` 指定時はレビュー / 修正 / 再 push をすべてスキップする
- 検証は `/check` をランタイム起動。インラインで PJ 固有の tsc/test/lint コマンドを書かない（PJ 移行で壊れるため）
