---
name: phase-review
description: /review-diff + /security-review を並列実行して指摘を統合し、採否を TaskCreate で承認ベース管理する。--fix で修正 + /check + コミットまで
---

# /phase-review

`/review-diff` と `/security-review` を 1 コマンドで回し、採否管理を統一する。
`/phase-ship` の中盤と同じロジック。レビューだけ単独で叩きたい場面のために分離。

## 設定読み取り（先頭で一度だけ）

CLAUDE.md は自動ロードされている。文脈中の `## Skills config` 見出し直下の最初の ```yaml フェンス内 YAML を参照して以下を確定する。
キーが無ければ既定値を使う:

| キー | 既定値 |
|---|---|
| `phase.base_branch` | `develop` |
| `phase.tasks_file` | `.claude/tasks.md` |
| `phase.commit_msg_hook_requires_tasks` | `true` |

config ブロック自体が無い PJ では、上記既定値で動作する旨をユーザーに 1 行で通知してから続行する。

## 引数

- `--pr <番号>` : PR の差分を対象にする（指定しない場合はローカル差分）
- `--fix` : 採用とした指摘について、ユーザー承認を得てから Edit で修正 + `/check` + コミットまで行う
- `--skip-security` : `/security-review` をスキップして `/review-diff` のみ実行
- `--skip-style` : `/review-diff` をスキップして `/security-review` のみ実行（セキュリティ単独監査用）

## 実行ステップ

### Step 1. 対象の確定

引数を解析:
- `--pr <番号>` 指定時:
  - `gh pr view <番号> --json title,body,baseRefName,headRefName` で PR メタ取得
  - 自動修正と同時指定（`--pr` + `--fix`）は **禁止**。中断してユーザーに「ローカルで PR ブランチを checkout してから再実行」を促す
- 指定なし（ローカル差分モード）:
  - `git diff HEAD` + `git status --porcelain`
  - 差分が空の場合、`git diff {{phase.base_branch}}...HEAD` にフォールバック（ブランチ全体）

### Step 2. レビューを並列起動

`--skip-security` / `--skip-style` を考慮し、以下を **単一メッセージ内で並列**起動する。
内容を本コマンドで再定義せず、ランタイムで対象コマンドを起動する（ドキュメント間の参照は仕様ズレの原因になるため避ける）。

#### 2a. `--skip-style` でない場合
`/review-diff`（`--pr <番号>` 指定時はそのまま渡す、`--fix` は本コマンドが管理するので渡さない）を起動して結果を待つ。confidence ≥ 80 の指摘を回収する。

#### 2b. `--skip-security` でない場合
`/security-review` を起動して結果を待つ。HIGH / MEDIUM のみ（confidence ≥ 0.8）を回収する。

### Step 3. 結果の統合

両者の出力を集めて以下を実施:

1. **重複統合**: 同じ `file:line` かつ同趣旨は 1 件にまとめる（severity / confidence は最大値を採用）
2. **採否提案**: 各指摘について以下の観点で「採用 / 不採用」を初期判定:
   - 採用: 新規導入のバグ / スタイル違反 / 修正コストが低い設計改善
   - 不採用: 既存挙動の継承で本 PR の責務外、確認のみ可能なもの、テストや手動検証が困難なもの
3. **TaskCreate** で採用提案分を `REV-1, REV-2, ...` として並べる

### Step 4. 採否提案の出力

```markdown
### Review summary

- Target: <local diff | PR #<番号>>
- /review-diff: M1 件（Critical X / Important Y）
- /security-review: M2 件（HIGH X / MEDIUM Y）
- 統合後: N 件（confidence ≥ 80）

### 採否提案

| # | 指摘 | file:line | confidence / severity | 採否提案 | 理由 |
|---|---|---|---|---|---|
| 1 | <要約> | path:42 | 90 / Critical | 採用 | 新規バグ |
| 2 | <要約> | path:5 | 85 / Important | 採用 | スタイル違反 |
| 3 | <要約> | path:34 | 85 / Medium | 不採用 | 既存挙動の継承、本 PR 範囲外 |

### 詳細

#### 1. <タイトル>
<説明 / file:line / 該当ルール / 修正案>

...
```

`--fix` でない場合はここで終了。ユーザーに「`/phase-review --fix` で修正を進めるか、個別に手動で対応するか」を案内する。

### Step 5. （`--fix` のみ）採否確定をユーザーに問う

「どの指摘を修正しますか？（番号指定 / `all` / `none` / `propose`）」

- `propose` を選んだ場合は、Step 3 の採否提案をそのまま採用とする
- `all` は全件採用、`none` は中断
- 番号指定（カンマ区切り）は明示採用

### Step 6. （`--fix` のみ）修正適用

採用とした指摘を Edit / Write で修正する:
- TaskUpdate で `in_progress` → `completed` を逐次更新
- 1 件ずつコミットしない（最後にまとめる）

### Step 7. （`--fix` のみ）/check を起動

`/check` スキルをランタイム起動し、結果を待つ。**インラインで個別コマンドを実行しない**（PJ 固有の検証コマンドは `/check` 側に閉じ込める）。

FAIL があれば、追加修正を試みるか中断する（**コミットは作らない**）。

### Step 8. （`--fix` のみ）tasks 更新 + コミット案

`commit_msg_hook_requires_tasks: true` の PJ では、`{{phase.tasks_file}}` の現フェーズセクション末尾に「レビュー対応 (REV-1〜REV-N)」の完了マークを追記する（commit-msg フックの tasks 必須要件を満たすため）。

`false` の PJ ではこの追記をスキップしてよい。

Conventional Commit スタイルでコミットメッセージ案を提示:
```
fix(<scope>): apply review feedback (REV-1〜REV-N)

<採用した指摘ごとに 1 行ずつ要約>

検証: <`/check` 結果サマリ>
```

ユーザー承認後に `git add` + `git commit`。**push は本コマンドの責務外**（必要なら `/phase-ship` または `git push` で個別に）。

### Step 9. 結果サマリ

```markdown
### Review result

- Target: <local diff | PR #<番号>>
- 統合指摘: N 件（採用 X / 不採用 Y）
- 修正適用: <X 件 / skip>
- /check: <PASS / FAIL>
- コミット: <oid> ... | skip
```

## 制約

- **自動コミット禁止**。`--fix` 時もユーザー承認を必ず挟む
- `--pr` と `--fix` の同時指定は禁止
- `commit_msg_hook_requires_tasks: true` の PJ では tasks 更新せずにコミットすると hook で弾かれるため、Step 8 で必ず追記する
- 検証は `/check` をランタイム起動。インラインで PJ 固有の tsc/test/lint コマンドを書かない（PJ 移行で壊れるため）
- push は本コマンドではしない（同じ作業の中で push したい場合は `/phase-ship` を使うか手動で）
- 採否提案はあくまで初期判定。最終決定はユーザーに委ねる
