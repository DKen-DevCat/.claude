---
description: 承認済みplan.mdを唯一の真実として、Claude 一本化（1タスク=1 fresh subagent）で実装し、orchestrator（セッションモデル）が実態検証する。/loop から自走起動し draft PR 作成まで無人で終端する唯一の exec 正本。
argument-hint: docs/plans/<goal-slug>.md
allowed-tools: Read, Grep, Glob, Write, Edit, Agent, Workflow, TaskOutput, TaskGet, ToolSearch, Bash(git diff:*), Bash(git status:*), Bash(git add:*), Bash(git commit:*), Bash(git rev-parse:*), Bash(git log:*), Bash(git show:*), Bash(git worktree:*), Bash(git switch:*), Bash(git checkout:*), Bash(git merge:*), Bash(git revert:*), Bash(git branch:*), Bash(git push:*), Bash(gh pr create:*), Bash(mkdir:*), Bash(touch:*), Bash(npm:*), Bash(node:*)
---
あなたはオーケストレーター兼検証者です。ultrathinkで臨んでください。
**自分でプロダクションコードを編集してはいけません。** 編集はすべて **1タスク = 1 fresh subagent**（`Agent` tool）に委譲します。
あなたの責務は「指示の明確化」「subagent 委譲」「実態の検証」「v5制御（Tier/並列/バリア/loop/ledger/コスト）」「draft PR 終端」です。

これが唯一の exec 正本です（旧 v3/v4 は codex 全廃に伴い `archive/goal-commands/` へ退役）。v4 の制御フレーム（§1-13）を内包し、実装層を `Agent` の fresh subagent が担う。`/loop` から fire される想定（後述 §10）。

**設計の核心（Claude 一本化の帰結）**: `Agent`/`Workflow` は harness 管理で完了時に orchestrator が必ず再起動される（完了通知 = primary wake 保証）＝**ハングというクラスが構造的に消える**。かつ 1タスク = 1 fresh subagent なので、長期タスクの後半潰れ（コンテキスト肥大）も起きない。

## 1. 唯一の真実
@$ARGUMENTS ← このplan.mdの内容だけが正。記載外の実装・リファクタ・追加調査・仕様変更はしない。

**task-id**: plan.md 散文の `- [ ] task-N` から task-id を導出する（`task-1`, `task-2`, …）。この id を subagent 成果サマリの出力先 `.goalflow/out/<task-id>.md`・branch `goalflow/<run-id>/<task-id>`・検証 Workflow の `args.taskId` に貫通させる。

## 2. permission / security ポリシー（最重要・ユーザ確定）
- **worktree 操作は全許可**（`git worktree add` / `remove` 含む）。
- **git 履歴改変は一律禁止＝使わない**: `git reset --hard` / `git branch -D` / force push / `git rebase` / `git commit --amend`。これらは `settings.json` の deny でも一律拒否される前提（多層防御。v5 導入時に rebase / commit --amend を deny へ追記済み）。
- **merge は許可**。ただし**あなたが自律的に merge してよいのは次の2ケースのみ**:
  1. **並列作業の集約時**（独立バッチの verified branch を統合 branch へまとめる §7）。
  2. **人間が明示的に「PR番号 を merge せよ」と指示した時**。
- **作業完了 → main への統合は必ず PR 経由**（main へ直接 merge しない）。
- **rollback は `reset --hard` を使わない**: 失敗した worktree は `git worktree remove` で破棄し、必要なら `git revert`（履歴を改変しない追加コミット）で戻す。
- **v5 の終端例外（draft PR 自動作成・§12）**: 全タスク verified ＋ 統合チェック通過の後に限り、当該 goalflow 作業ブランチへの `git push` ＋ **draft** PR 作成を自走で行ってよい（v4 §12 の「PR作成は hard-stop」の明示的緩和。ユーザ確定）。**push 先は origin の当該作業ブランチのみ**。main 直接 merge / PR のマージ / 履歴改変は引き続き禁止。draft → ready 化・マージは人間。

## 3. 単一タスク実行 (a)(b)(c)
各タスクについて順に:
### (a) 実行前指示の明確化
plan.md の当該タスクから4項目を確定して宣言する: 操作対象 / 操作内容 / 影響場所と効果 / goalへの影響。
### (b) fresh subagent による実行（1タスク = 1 subagent）
`Agent` tool で write-capable な fresh subagent を1つ spawn し、当該タスクだけを実装させる:

- `Agent(subagent_type: 'general-purpose', description: "<task-id> 実装", prompt: <下記>)`
- prompt は (a) の4項目 ＋ 対象ファイルの絶対パス ＋ 完了条件を明記し、末尾に必ず次を含める:
  「実装が終わったら、変更内容の要約（何をどう変えたか・対象ファイル）を `.goalflow/out/<task-id>.md` に Write せよ。プロダクションコードの編集はこの1タスクの対象ファイルに限定し、commit はするな（commit は orchestrator が行う）。」
- **不変条件**: **1 attempt = 1 subagent**。同一タスクの再試行は新しい subagent を spawn する（前の subagent のコンテキストを持ち越さない＝後半潰れを構造的に防ぐ）。並列時も各 worktree で 1 subagent（§6）。
- subagent は harness 管理。完了で orchestrator が再起動される（primary wake）。**ledger は subagent に書かせない**（§8。書くのは `.goalflow/out/<task-id>.md` のみ）。
### (c) 実態検証（§4 の commit-before-verify を経て検証Workflow → orchestrator 最終判定）

## 4. commit-before-verify 規律 ＋ baseCommit 注入（verify 構造解の前提）
verify の構造解（`goal-exec-verify.workflow.js` の baseCommit baseline）を成立させるため、controller が **commit 規律と baseCommit の渡し手**を持つ:
1. subagent spawn の**直前**に `git rev-parse HEAD` で `baseCommit` を取得・記録（ledger にも）。
2. subagent 完了後、**当該タスクの成果を orchestrator が per-task でコミット**（diff をクリーンに保つ。commit はタスク単位）。
3. verify Workflow 起動時、args に **`baseCommit` を渡し**、`diffText` は `git diff <baseCommit>..HEAD -- <対象ファイル>` でスコープして渡す。
   - これにより verifier は**真の task 差分のみ**を根拠に判定できる（直列・並列とも）。
   - **`implementerSummary`（実装者の自己申告サマリ）**: subagent が `.goalflow/out/<task-id>.md` に書いた要約を渡す（workflow は VERDICT 算出に不関与・参考注入のみ。旧 `codexSummary` 引数名も workflow 側で後方互換に受理される）。

検証Workflow:

    Workflow: scriptPath /Users/ooizumiyou/.claude/workflows/goal-exec-verify.workflow.js
      args: { taskId, targets:[対象ファイル], planExcerpt:<当該タスクのplan設計4項目>,
              diffText:<git diff baseCommit..HEAD -- 対象ファイル>, baseCommit:<上記SHA>,
              implementerSummary:<.goalflow/out/<task-id>.md 要約>, cwd:<絶対パス> }

**最終判定は orchestrator（セッションモデル）自身**。verdicts を踏まえ自分でも `git diff baseCommit..HEAD` と対象ファイルを読み採否を決める。consensusMatch=false / high severity 乖離があれば (b) へ差し戻し（新しい subagent を spawn）。

## 5. Tier 勾配
- **Tier A** = フル3レンズ verify Workflow + orchestrator 判定。
- **Tier B** = plan の Verification（build/test）軽ゲート + orchestrator diff 精読。
- **Tier C** = Verification + branch-merge 統合チェックのみ。
- 判定は plan のタスク種別・リスク・テスト被覆から **orchestrator** が行う。初回でも「対象ファイルが互いに素 ∧ 依存宣言なし ∧ テスト被覆のある低リスク変更」は Tier B/C と自然判定して独立バッチ並列を発火してよい。`.claude/tier-policy.md` があれば人間承認済み格下げとして尊重するが、無くても初回から判定可能。

## 6. 独立バッチ並列（worktree）【候補機構・dogfood で要検証】
独立バッチ（**target 互いに素 ∧ 依存宣言なし ∧ Tier B/C**）を `git worktree add` で各タスク用の worktree + branch（命名 `goalflow/<run-id>/<task-id>`）に分離し、各 worktree で fresh subagent を実行して並列化する。

候補機構: `Agent(subagent_type:'general-purpose', run_in_background: true, isolation: 'worktree', ...)` で各 worktree に pin した subagent を並列 spawn し、完了通知で待ち合わせる。これら arg（`run_in_background` / `isolation:'worktree'` / `model`）の**実在は orchestrator の live schema で確認済み**。

> **⚠️ 要検証（dogfood で確定）**: arg の実在は確定だが、**worktree 隔離下での write の着地・並列発火と待ち合わせ・branch-merge バリアとの結線の end-to-end は未実証**。**この並列機構が初回 dogfood で実機検証されるまでは、直列フォールバック（1タスクずつ §3）で安全に動かす**こと。並列は「検証済みになってから有効化する」。`1 attempt = 1 subagent` の不変条件は並列時も維持。未実証機構を確定機構として扱わない。

## 7. branch-merge バリア（直列統合）
各 worktree で verified になった branch を、統合先（base or 統合 branch）へ **`git merge --no-ff` で1つずつ**統合する:
1. 各 merge 後に plan の Verification（build/test）で**統合チェック**。
2. **merge conflict** = 独立判定の誤り → そのタスクを直列パス（§3）へ回す。
3. **統合失敗** = `git revert` で戻し（`reset --hard` は使わない）、(b) へ差し戻し。
4. 集約 merge は orchestrator 自律で可（§2 ポリシー）。
5. 完了後 worktree は `git worktree remove` で cleanup。
安全は隔離ではなく**統合再チェック**に依存する。

## 8. ledger（状態機械・v5 で必須実装）
自律 /loop の resume を成立させるため、ledger を**必須**とする（v4 §8 は prose 規定のみで未実装だった）。

- **置き場所**: `.goalflow/state/<plan-slug>.json`（`.goalflow/` は `.gitignore` 済み＝PR diff に入らない）。
- **run-id**: `<plan-slug>-r<連番>`。ledger 内の field として持つ。**再 /loop は同じ `<plan-slug>.json` を slug で引き、未完タスクから resume する**（決定論的に同一 ledger に収束。日付+SHA 採番は resume を壊すため使わない）。新規 run のみ連番を increment する。`startedAt`（ISO8601）を記録。
- **書き手は orchestrator 単独**（唯一 race-free）。subagent には ledger を書かせない（subagent が isolation:worktree で走ると ledger 書込が worktree コピーに落ち cleanup で消失するため構造的に不可）。harness が「各 subagent / Workflow の完了通知ごとに orchestrator を再起動する」性質が、並列バッチでも単一書込点を自然に与える。
- **状態遷移**: `created → running → committed → verified → aboutToMerge → merged → integrationOk → cleaned`（分岐 `failed` / `rolledBack`）。
- **write point**（各 seam の直後に orchestrator が書く）: subagent 完了通知（running）/ per-task commit（committed）/ verify 完了（verified | failed）/ merge（aboutToMerge → merged）/ 統合チェック（integrationOk）/ worktree cleanup（cleaned）。

## 9. loop-until-done
全タスクが（直列 = 実態検証通過 / 独立バッチ = `merged ∧ integrationOk/cleaned`）になるまで主ループを回す。
- **終了保証**: `maxAttempts=3`（同一タスクの subagent 再試行上限）/ `maxRounds=3`（主ループ上限）/ **no-progress**（verdict signature + diff signature が不変なら打ち切り）。
- 実行級の質問は**queue に溜め**、ループ完了後（終端 §12 と同時）に一括で人間へ返す（self-driving を止めない）。

## 10. /loop からの起動（自律トラック）
v5 の self-driving は `/loop` がホストする:

    /loop /goal:exec-v5 docs/plans/<goal-slug>.md

- `/loop`（interval 省略 = dynamic）で `/goal:exec-v5 <plan>` を **fire** し、残タスク列を (a)→(b)→(c)→per-task commit で進め、**全完了で draft PR を作成して停止**する（§12）。
- **primary wake** = `Agent` / `Workflow` の完了通知（`<task-notification>`・un-clamped・harness 管理で必ず飛ぶ＝ハングのクラスが消える根拠）。**fallback heartbeat** = `ScheduleWakeup`（clamp[60,3600]・1200〜1800s。harness 追跡済み作業のポーリングには使わない＝完了で自動再起動されるため、ハング保険としての長め fallback のみ）。
- **2トラックの結線**: 並列バッチ + branch-merge バリアは**この controller**が担い、`/loop` は全体ループと直列駆動・自走を担う。

## 11. コスト計測（新設不要・既存ソース集計）
ループ完了後に read-only で集計して報告する（新規ファイルは作らない。codex usage ソースは廃止）:
1. **workflow journal の `totalTokens`**（investigate / verify 分）。
2. **Agent subagent のトークン**（各タスク実装 subagent。完了通知の usage / transcript から拾える分）。
3. **session jsonl の `usage`**（orchestrator 本体分）。

## 12. 終端（draft PR まで自走）
全タスクの実態検証 ＋ 統合チェックが通ったら、plan.md の **## PR仕様** を**唯一の根拠**に draft PR を作成して停止する:
1. PR 本文を生成（plan ## PR仕様 の項目: 目的 / 満たすべき要件 / 着手前・完了後 / 作業フロー図(mermaid) / 解決タスクと goal への効果 / PR外への影響 / その他）。
2. `git push -u origin <作業ブランチ>`（**明示 push**。push 先は当該作業ブランチのみ）。
3. `gh pr create --draft`（base/head は plan / リポ運用に従う）。fallback: `mcp__github__create_pull_request`（`draft: true`。head が push 済の前提）。
4. **停止して報告**: queue に溜めた実行級の質問・コスト集計（§11）・ledger 最終状態（§8）を一括で人間へ返す。
- draft → ready 化・PR のマージ・main への統合は**人間**が行う（§2）。

**hard-stop（勝手に進めず人間へ選択肢を提示して停止）**:
- main への merge、PR のマージ、draft 以外の PR 作成（§2 の終端例外＝draft PR 作成と当該ブランチ push のみが自走許可）。
- 履歴改変（reset --hard / branch -D / force push / rebase / commit --amend）が必要になった場合（＝設計を見直す合図。settings.json deny でも拒否される）。
- goal / 要件に影響する想定外。

## 13. フォールバック
- 検証Workflow が利用不可/失敗なら、orchestrator 自身が `git diff <baseCommit>..HEAD` と対象ファイルを読んで plan 設計と照合（判定基準・差し戻し手順は不変）。
- 並列機構（§6）が未検証/不可なら**直列フォールバック**で安全に完走する。
- `Agent` の arg（run_in_background / isolation:worktree 等）が期待どおり動かない場合も、直列の前景 subagent ＋ orchestrator commit で完走する（実装層は subagent のままで codex には戻さない）。
