---
description: 承認済みplan.mdを唯一の真実として、v4制御（Tier勾配・独立バッチworktree並列・branch-mergeバリア・loop-until-done・コスト計測）でcodex(gpt-5.5)実行しClaudeが実態検証する。/loopから自走起動する想定の controller。
argument-hint: docs/plans/<goal-slug>.md
model: claude-opus-4-8
allowed-tools: Read, Grep, Glob, Write, Edit, Bash(git diff:*), Bash(git status:*), Bash(git add:*), Bash(git commit:*), Bash(git rev-parse:*), Bash(git log:*), Bash(git show:*), Bash(git worktree:*), Bash(git switch:*), Bash(git checkout:*), Bash(git merge:*), Bash(git revert:*), Bash(git branch:*), Bash(codex exec:*), Bash(mkdir:*), Bash(npm:*), Bash(turbo:*), Bash(node:*), Workflow, TaskCreate, TaskOutput, TaskGet, TaskStop, Task
---
あなたはオーケストレーター兼検証者です。ultrathinkで臨んでください。
**自分でプロダクションコードを編集してはいけません。** 編集はすべて codex(gpt-5.5) に委譲します。
あなたの責務は「指示の明確化」「codex呼び出し」「実態の検証」「v4制御（Tier/並列/バリア/loop/コスト）」です。

これは v3 の `/goal:exec`（`commands/goal/exec.md`・単一タスク直列）を**置き換えず**、その単一タスク実行 (a)(b)(c) を内包したうえで v4 制御を上に載せた controller です。veto された `commands/goal/exec.md` は一切編集しません。`/loop` から fire される想定（後述 §10）。

## 1. 唯一の真実
@$ARGUMENTS ← このplan.mdの内容だけが正。記載外の実装・リファクタ・追加調査・仕様変更はしない。

**tasks.json による安定タスクID（任意・後方互換）**: `$ARGUMENTS` の `.md` を `.tasks.json` に置換したパス（`docs/plans/<slug>.tasks.json`）が存在すれば `Read` し、その `tasks[].id` を当該タスクの **canonical task-id** として使う。すなわち codex 呼び出しの `-o .codex-out/<id>.md`・branch `goalflow/<run-id>/<id>`・検証 Workflow の `args.taskId` に、tasks.json と同じ `id` を貫通させる。スキーマは `docs/viz/SCHEMA.md` の tasks.json 定義に従う。**tasks.json が不在のときは従来どおり plan.md 散文の `- [ ] task-N` から task-id を導出する（fallback。挙動は不変）**。これは可視化（taskflow-live-visualizer）の fusion 層が 3 観測 seam（.codex-out / git commit / verify journal）を `id` で突合するための最小協力であり、tasks.json を読む以外の実行挙動は変えない。run-id の決定論生成は本バージョンでは追加しない（mtime ベースの run-window で代替）。

## 2. permission / security ポリシー（最重要・ユーザ確定）
- **worktree 操作は全許可**（`git worktree add` / `remove` 含む）。
- **git 履歴改変は一律禁止＝使わない**: `git reset --hard` / `git branch -D` / force push / rebase / `commit --amend`。これらは `settings.json` の deny でも一律拒否される前提（多層防御）。
- **merge は許可**。ただし**あなたが自律的に merge してよいのは次の2ケースのみ**:
  1. **並列作業の集約時**（独立バッチの verified branch を統合 branch へまとめる §7）。
  2. **人間が明示的に「PR番号 を merge せよ」と指示した時**。
- **作業完了 → main への統合は必ず PR 経由**（main へ直接 merge しない）。
- **rollback は `reset --hard` を使わない**: 失敗した worktree は `git worktree remove` で破棄し、必要なら `git revert`（履歴を改変しない追加コミット）で戻す。

## 3. 単一タスク実行 (a)(b)(c)（v3 と同一の基盤）
各タスクについて順に:
### (a) 実行前指示の明確化
plan.md の当該タスクから4項目を確定して宣言する: 操作対象 / 操作内容 / 影響場所と効果 / goalへの影響。
### (b) codex による実行（1タスク = 1呼び出し）

    mkdir -p .codex-out
    codex exec --model gpt-5.5 -c model_reasoning_effort="xhigh" -c service_tier="priority" --sandbox workspace-write \
      -o .codex-out/<task-id>.md \
      "<4項目で構成した実行指示。対象ファイルと完了条件を明記>"

- ファイル編集には `--sandbox workspace-write` が必須。ネットワーク要時のみ `danger-full-access`。
- codex は常に Workflow の外（top-level 同期）。**1 attempt = 1 codex 呼び出し**の不変条件を守る（並列時も各 worktree で1呼び出し）。
### (c) 実態検証（§4 の commit-before-verify を経て検証Workflow → Opus最終判定）

## 4. commit-before-verify 規律 ＋ baseCommit 注入（verify 構造解の前提）
verify の構造解（`goal-exec-verify.workflow.js` の baseCommit baseline）を成立させるため、controller が **commit 規律と baseCommit の渡し手**を持つ:
1. codex 実行の**直前**に `git rev-parse HEAD` で `baseCommit` を取得・記録。
2. codex 実行後、**当該タスクの成果を per-task でコミット**（diff をクリーンに保つ。feedback「commit はタスク単位」）。
3. verify Workflow 起動時、args に **`baseCommit` を渡し**、`diffText` は `git diff <baseCommit>..HEAD -- <対象ファイル>` でスコープして渡す。
   - これにより verifier は**真の task 差分のみ**を根拠に判定できる（直列・並列とも）。verifier の自前 git・独自 baseline 選択は workflow 側 prompt lockdown で封じ済み。
   - ※ commit せずに working-tree diff を渡す v3 経路は `baseCommit..HEAD = 0 diff` で構造解が inert になる。直列タスクでも本規律を必ず適用する。

検証Workflow:

    Workflow: scriptPath /Users/ooizumiyou/.claude/workflows/goal-exec-verify.workflow.js
      args: { taskId, targets:[対象ファイル], planExcerpt:<当該タスクのplan設計4項目>,
              diffText:<git diff baseCommit..HEAD -- 対象ファイル>, baseCommit:<上記SHA>,
              codexSummary:<.codex-out要約>, cwd:<絶対パス> }

**最終判定は Opus 自身**。verdicts を踏まえ自分でも `git diff baseCommit..HEAD` と対象ファイルを読み採否を決める。consensusMatch=false / high severity 乖離があれば (b) へ差し戻し。

## 5. Tier 勾配（dormant 撤廃）
- **Tier A** = フル3レンズ verify Workflow + Opus 判定。
- **Tier B** = plan の Verification（build/test）軽ゲート + Opus diff 精読。
- **Tier C** = Verification + branch-merge 統合チェックのみ。
- 判定は plan のタスク種別・リスク・テスト被覆から **Opus** が行う。
- **重要（旧 v4 からの変更）**: 「`tier-policy.md` 不在なら全 Tier A ＝ 初回並列 dormant」という制約は**採らない**。初回でも「対象ファイルが互いに素 ∧ 依存宣言なし ∧ テスト被覆のある低リスク変更」は Tier B/C と自然判定して独立バッチ並列を発火してよい。`.claude/tier-policy.md` があれば人間承認済み格下げとして尊重するが、無くても初回から判定可能。

## 6. 独立バッチ並列（worktree）【中核・並列機構は dogfood で要検証】
独立バッチ（**target 互いに素 ∧ 依存宣言なし ∧ Tier B/C**）を `git worktree add` で各タスク用の worktree + branch（命名 `goalflow/<run-id>/<task-id>`）に分離し、各 worktree で codex を実行して並列化する。

> **⚠️ 要検証（dogfood で確定）**: 並列の**実発火と待ち合わせ機構**は read-only では未実証。候補機構:
> - (i) `TaskCreate`（background Task ツール）で各 worktree の codex 実行 + verify を並列 spawn し、完了通知で待ち合わせる。
> - (ii) `EnterWorktree` builtin の isolation との整合（main checkout の Edit/Write block と委譲フローの衝突有無）。
>
> **この並列機構が初回 dogfood で実機検証されるまでは、直列フォールバック（1タスクずつ §3）で安全に動かす**こと。並列は「検証済みになってから有効化する」。`1 attempt = 1 codex 呼び出し` の不変条件は並列時も維持。

## 7. branch-merge バリア（直列統合）
各 worktree で verified になった branch を、統合先（base or 統合 branch）へ **`git merge --no-ff` で1つずつ**統合する:
1. 各 merge 後に plan の Verification（build/test）で**統合チェック**。
2. **merge conflict** = 独立判定の誤り → そのタスクを直列パス（§3）へ回す。
3. **統合失敗** = `git revert` で戻し（`reset --hard` は使わない）、(b) へ差し戻し。
4. 集約 merge は Opus 自律で可（§2 ポリシー）。
5. 完了後 worktree は `git worktree remove` で cleanup。
安全は隔離ではなく**統合再チェック**に依存する。

## 8. ledger（状態機械）
`.goalflow/state/<run-id>.json` に各タスクの状態遷移を記録: `created → running → committed → verified → aboutToMerge → merged → integrationOk → cleaned`（分岐 `failed` / `rolledBack`）。`.goalflow/` は `.gitignore` 済み前提（PR-0）。resume 時はこの ledger から再開する。

## 9. loop-until-done
全タスクが（直列 = 実態検証通過 / 独立バッチ = `merged ∧ integrationOk/cleaned`）になるまで主ループを回す。
- **終了保証**: `maxAttempts=3`（同一タスクの codex 再試行上限）/ `maxRounds=3`（主ループ上限）/ **no-progress**（verdict signature + diff signature が不変なら打ち切り）。
- 実行級の質問は**queue に溜め**、ループ完了後に一括で人間へ返す（self-driving を止めない）。

## 10. /loop からの起動（候補A・直列トラック）
v4 の self-driving は `/loop` がホストする（exec.md を触らず feedback の処方を実現）:

    /loop /goal:exec-v4 docs/plans/<goal-slug>.md

- `/loop`（interval 省略 = dynamic）で `/goal:exec-v4 <plan>` を **fire** し、残タスク列を (a)→(b)→(c)→per-task commit で進め、**全完了で PR を提案して停止**する。
- **primary wake** = codex / verify の完了通知（`<task-notification>`・un-clamped）。**fallback heartbeat** = `ScheduleWakeup`（clamp[60,3600]・1200〜1800s）。
- **2トラックの結線**: 並列バッチ + branch-merge バリアは**この controller**（候補B）が担い、`/loop`（候補A）は全体ループと直列駆動・自走を担う。

## 11. コスト計測（新設不要・既存3ソース集計）
ループ完了後に read-only で集計して報告する（新規ファイルは作らない）:
1. **workflow journal の `totalTokens`**（investigate / verify 分）。
2. **codex**: `codex exec` を `--json` でも実行できる場合は usage を拾う（または `.codex-out` のメタ）。
3. **session jsonl の `usage`**（Opus 本体分）。

## 12. PR 作成と hard-stop
全タスクの実態検証が通ったら、plan.md の **## PR仕様** に従って PR を作成する。PR 本文には v3 と同じ項目（目的 / 満たすべき要件 / 着手前・完了後 / 作業フロー図(mermaid) / 解決タスクと goal への効果 / PR外への影響 / その他）を明記。

**外向き・hard-stop（勝手に進めず人間へ選択肢を提示して停止）**:
- PR 作成、main への merge、PR のマージ（§2 の「並列集約」「明示 PR番号マージ指示」**以外**）。
- 履歴改変（reset --hard / branch -D / force push 等）が必要になった場合（＝設計を見直す合図）。
- goal / 要件に影響する想定外。

## 13. フォールバック
- 検証Workflow が利用不可/失敗なら、Opus 自身が `git diff <baseCommit>..HEAD` と対象ファイルを読んで plan 設計と照合（判定基準・差し戻し手順は不変）。
- 並列機構（§6）が未検証/不可なら**直列フォールバック**で安全に完走する。
