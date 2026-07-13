---
name: deep-review
description: 明示的に呼ばれた時だけ発動する高品質レビュースキル。変更差分（または PR / 指定パス）を、ドメイン知識を注入した観点別 lens で並列レビューし、各指摘を多票で敵対検証して偽陽性を落とし、severity 付きの改善提案を返す。/code-review（汎用バグ）や /security-review（脆弱性）より深く、ドメイン不変条件・仕様整合・データモデル・API 契約まで見る。既定はレポートのみ（--fix 指定時のみ承認ベースで修正）。
---

# /deep-review

明示的に呼ばれたときだけ動く、最高品質のコードレビュースキル。
変更差分（または PR・指定パス）を、**ドメイン知識を注入した観点別 lens** で並列レビューし、
各指摘を**視点分散の多票 verifier が敵対的に検証**して偽陽性を落とし、severity 付きの改善提案を返す。
`/code-review`（汎用バグ）や `/security-review`（脆弱性）より深く、**ドメイン不変条件・仕様整合・データモデル・API 契約**まで見る。

レビュー本体は Workflow `deep-review-engine` が担い、本スキルは「対象確定・ドメイン知識の自動探索・最終採否判定・出力・`--fix`」を担う。
lens の**枠は本スキルに同梱**（Workflow 内 `LENSES`）、**中身（ドメイン知識）は repo から実行時に自動探索**して注入する。

モデル方針: orchestrator（本スキル）= セッションモデル（既定は settings.json＝`~/.claude/CLAUDE.md` の「モデル台帳」参照。`/model` 明示切替時はそれ）。lens / verifier = Sonnet（Workflow 側で固定）。

## 設定読み取り（先頭で一度だけ）

CLAUDE.md は自動ロードされている。文脈中の `## Skills config` 見出し直下の最初の ```yaml フェンス内 YAML を参照する。キーが無ければ既定値を使う:

| キー | 既定値 | 用途 |
|---|---|---|
| `phase.base_branch` | `develop` | 差分が空のときの `git diff {base}...HEAD` フォールバック先 |

config が無い PJ では上記既定で動く旨を 1 行通知してから続行する。

## 引数

- 引数なし: 作業差分 `git diff HEAD`（未追跡ファイルも Read で対象に含める）
- `--pr <番号>`: `gh pr diff <番号>` の出力を対象にする
- `<path>`: 指定パス/ディレクトリのサブシステムを対象（差分が無くても既存コードをレビュー）
- `--base <ref>`: 差分のベースを明示（既定 `HEAD`。差分が空なら `{base_branch}...HEAD`）
- `--effort <low|medium|high|max>`: レビュー深度（既定 `high`）。verifier 票数と探索ラウンド数を制御
  - `low`: verifier 1票・1ラウンド（軽量・1票でも refute で棄却）
  - `medium`: verifier 2票・1ラウンド
  - `high`（既定）: verifier 3票・最大2ラウンド
  - `max`: verifier 3票・最大3ラウンド（最深）。`xhigh` は `max` の別名として受理される
- `--fix`: 採用した指摘のみ、ユーザー承認を得てから Edit → `/check` → 承認コミット（既定はレポートのみ）

## 実行ステップ

### Step 1. 対象の確定

引数を解析し、レビュー対象を確定する。

- `--pr <番号>` 指定時:
  - `--pr` と `--fix` の**同時指定は禁止**。中断して「ローカルで PR ブランチを checkout してから再実行」を促す
  - `gh pr view <番号> --json title,baseRefName,headRefName` でメタ取得、`gh pr diff <番号>` でパッチ取得、`gh pr diff <番号> --name-only` で変更ファイル取得
  - PR ブランチがローカル checkout されていなければ `localFilesMatch=false` として渡す（Workflow は diff 本文を一次根拠にする）
- `<path>` 指定時（差分レビューでなくサブシステムレビュー）:
  - 対象パス配下のファイルを変更ファイル扱いにし、`diffText` は空でよい（lens が Read で全体をレビュー）
- 指定なし（ローカル差分モード）:
  - `git diff HEAD`（`--base` があれば `git diff <base>`）でパッチ取得。空なら `git diff {base_branch}...HEAD` にフォールバック
  - `git status --porcelain` で未追跡ファイルを拾い、変更ファイル一覧に含める
- `baseCommit` を取得する: `--base <ref>` 指定時は `git rev-parse <ref>`、指定なし時は `git rev-parse HEAD`（差分の比較起点と一致させる）
- `<path>` モードでは `diffText` キーを省略して渡す（Workflow が差分なし＝全体レビューと判定する）。`--pr` かつローカル未 checkout のときのみ `localFilesMatch=false` を渡す

### Step 2. ドメイン知識の自動探索（同梱 lens ×「中身」の注入）

Glob / LS で次を探し、**存在するパスだけ** `domainSources` に集める（内容は lens 側が Read する。ここではパス列挙のみでコンテキストを膨らませない）:

- プロジェクト側 `CLAUDE.md`（グローバル `~/.claude/CLAUDE.md` は自動ロード済みなので project 側を優先）
- `docs/**`（設計・仕様・ADR・glossary）、`README*`
- `.claude/design/**`、`.claude/rules/**`、`.claude/plan.md`、`.claude/tasks*`
- `docs/plans/**`（承認済み plan があれば仕様整合の一次資料）

変更ファイルのパスから**関連の高い文書に絞る**（全部盛りにしない）。0 件でも続行する（lens が自力探索する）。

### Step 3. Workflow `deep-review-engine` を起動

Workflow ツールを `name: 'deep-review-engine'`、`args` に次を渡して起動し、結果を待つ:

```json
{ "target": "<local diff | PR #n | path: ...>", "diffText": "<git/gh diff 全文。path モードでは省略>", "changedFiles": ["<変更ファイル>"], "baseCommit": "<Step 1 の baseCommit>", "domainSources": ["<Step 2 のパス>"], "cwd": "<cwd>", "localFilesMatch": "<--pr 未 checkout 時のみ false、既定は省略>", "effort": "<--effort の値、既定 high>" }
```

**すべての値は Step 1-2 で確定した実値を埋める**（上はプレースホルダ。`effort`/`localFilesMatch` を固定値で書かない）。`path` モードでは `diffText` キーごと省略する。

Workflow は観点別 lens 並列レビュー（confidence≥80）→ file:line dedup → 敵対的多票検証（refute しない側が厳密過半数のときのみ生存＝精度優先）→ effort 勾配で有界ループ、を回して `confirmed` 指摘と統計（`lensCount`・`verifyVotes`・`roundsRun`・`maxRounds`・`rounds`）を返す。件数は返り値の `lensCount` を使い、ハードコードしない。各 `confirmed` は代表 `lens` と、同一箇所を複数観点が指摘した場合の `lenses[]`、票欠け時の `underVerified` を持つ。

### Step 4. 最終採否判定（orchestrator = セッションモデル）

`confirmed` を受け取り、Workflow の投票は**判断材料**として、各件に採用/不採用の初期判定を付ける:

- 採用: 新規に持ち込んだバグ / ドメイン不変条件違反 / 仕様ズレ / 後方非互換 / 低コストで直る設計改善
- 不採用: 既存挙動の継承で本変更の責務外 / 確認のみで検証困難 / 好みの範囲

### Step 5. 出力（レポート）

```markdown
### Deep review summary

- Target: <local diff | PR #<番号> | path: <path>>
- Base: <baseCommit>
- Lenses: <lensCount> / verify votes: <verifyVotes> / rounds: <roundsRun>（最大 <maxRounds>）
- Domain sources: <参照した文書のカンマ区切り | none>
- Confirmed: <M> 件（critical X / high Y / medium Z / low W、敵対検証を生存）
- ※ <underVerified が真の件数>件は agent 失敗で票欠け（under-verified）— 参考扱い

### 採否提案

| # | 指摘 | file:line | severity / confidence | lens | 採否 | 理由 |
|---|---|---|---|---|---|---|
| 1 | <要約> | path:42 | critical / 95 | domain-invariants | 採用 | ドメイン不変条件違反 |
| 2 | <要約> | path:12 | high / 88 | correctness | 採用 | 新規バグ |
| 3 | <要約> | path:7 | medium / 82 | maintainability | 不採用 | 既存挙動、本変更の責務外 |

`lens` 列は代表 `lens` を表示し、同一箇所を複数観点が指摘した場合は `lenses[]` を `/` 区切りで併記する（例: `domain-invariants/correctness`）。`underVerified` の件は行末に `⚠️票欠け` を付す。

### 詳細

#### 1. <タイトル>
- file: `path:42` / severity: critical / confidence: 95 / lens: domain-invariants
- 根拠: <evidence>
- 改善提案: <suggestion>

...

### No issues found
（confirmed が 0 件のときはこれのみ。lens/rounds/verify votes は明記する）
```

`--fix` でない場合はここで終了。「`/deep-review --fix` で修正を進めるか、個別に手動対応するか」を案内する。

### Step 6.（`--fix` のみ）修正

1. 「どの指摘を修正しますか？（番号指定 / `all` / `none` / `propose`）」を問う（`propose` = Step 4 の採用提案をそのまま採用）
2. 採用分のみ Edit / Write で適用（1 件ずつコミットしない）
3. 検証を待つ。**インラインで PJ 固有の tsc/test/lint を固定で書かない**（PJ 移行で壊れるため）:
   - `/check` が利用可能ならランタイム起動する。
   - 無ければ PJ の検証手段を検出して実行する（`package.json` の `scripts.check`/`test`/`lint`、`Makefile`、`justfile`、`.claude/skills/check` 等）。
   - いずれも見つからなければ、**ユーザに検証コマンドを確認してから**進む（勝手に PASS 扱いしない）。
4. FAIL なら追加修正を試みるか中断（**コミットは作らない**）
5. PASS なら Conventional Commit スタイルのメッセージ案を提示し、**ユーザー承認後**に Edit/Write で変更したファイルのみを `git add <file>...` で個別に add してから `git commit`（`git add -A`/`.` は使わない — 無関係な変更の混入を防ぐ）。**push はしない**

## 制約

- **明示呼び出し専用**。Stop フック等での自動発火はしない（自動レビュー禁止の運用方針）
- 既定は**レポートのみ**。**自動コミット禁止**、`--fix` でも必ずユーザー承認を挟む
- **`--pr` と `--fix` の同時指定は禁止**
- **push しない・git 履歴改変しない**
- 検証は `/check`（無ければ PJ の検証手段）をランタイム起動。インラインで PJ 固有コマンドを書かない（PJ 移行で壊れるため）
- confidence < 80 の指摘は報告しない（ノイズ削減）
- lens / verifier は read-only。指摘は必ず実ファイル（`path:line`）を根拠にする（自己申告・推測は verifier が refute する）
- 採否提案はあくまで初期判定。最終決定はユーザーに委ねる
