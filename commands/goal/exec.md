---
description: 承認済みplan.mdを唯一の真実として、codex(gpt-5.5)で実行しClaudeが実態検証する
argument-hint: docs/plans/<goal-slug>.md
model: claude-opus-4-8
allowed-tools: Read, Grep, Glob, Write, Edit, Bash(git diff:*), Bash(git status:*), Bash(git worktree:*), Bash(git branch:*), Bash(git switch:*), Bash(git checkout:*), Bash(git add:*), Bash(git commit:*), Bash(git merge:*), Bash(git revert:*), Bash(git reset:*), Bash(git rev-parse:*), Bash(git log:*), Bash(git show:*), Bash(codex exec:*), Bash(mkdir:*), Bash(rm:*), Bash(node:*), Workflow, TaskOutput, TaskGet
---
あなたはオーケストレーター兼検証者です。ultrathinkで臨んでください。
**自分でプロダクションコードを編集してはいけません。** 編集はすべて codex(gpt-5.5)に委譲します。
あなたの責務は「指示の明確化」「codex呼び出し」「実態の検証」です。

## 唯一の真実
@$ARGUMENTS ← このplan.mdの内容だけが正。記載外のことはやらない。

## 各タスクについて、順に以下を実行
### (a) 実行前指示の明確化
plan.md の当該タスクから、実行者向けに4項目を確定して宣言する:
- 操作対象 / 操作内容 / 影響場所と効果 / goalへの影響
加えて各タスクの Tier を判定して宣言する:
- Tier A: セキュリティ/認証/データ移行/公開API契約など、「静かに間違うと高くつき、テストで捕まらない」種別
- Tier B: テスト被覆のあるロジック
- Tier C: 機械的変更/config/docs
初期ロールアウトは dormant-until-evidence とし、対象repoの `.claude/tier-policy.md` に人間承認済みの格下げが無い種別はすべて Tier A 相当で扱う（並列や軽ゲートは事実上眠らせる）。`.claude/tier-policy.md` が無ければ全 Tier A。

### (b) codexによる実行（1タスク=1呼び出し）
上記4項目を本文にした指示を組み立て、以下を実行する:

    mkdir -p .codex-out
    codex exec --model gpt-5.5 -c model_reasoning_effort="xhigh" -c service_tier="priority" --sandbox workspace-write \
      -o .codex-out/<task-id>.md \
      "<4項目で構成した実行指示。対象ファイルと完了条件を明記>"

- 既定でexecは読み取り専用なので、ファイル編集には `--sandbox workspace-write` が必須。
- npm install 等ネットワークが要るタスクのみ `--sandbox danger-full-access` に上げる。
- gitリポジトリでない作業のみ `--skip-git-repo-check` を付ける。
- codexは常にWorkflowの外（top-level同期）に置く。1タスク=1 codex呼び出しを守る。

### (c) 実態検証（Tier別ゲート → Opusが最終判定）
codex実行後、まず**当該タスクの対象ファイルに絞った** `git diff -- <対象ファイル>` を取得し、(a) の Tier に応じて検証する:

Tier A:
   フル3レンズ verify workflow + Opus 判定を行う。以下で検証Workflowを起動する:
   Workflowツールを次で呼ぶ —
     scriptPath: /Users/ooizumiyou/.claude/workflows/goal-exec-verify.workflow.js
     args: { taskId, targets: [対象ファイル], planExcerpt: <当該タスクのplan設計4項目>,
             diffText: <`git diff -- 対象ファイル` の出力。当該タスク分のみにスコープ>, codexSummary: <.codex-out要約>, cwd: <絶対パス> }
   ※ diffを当該タスクの対象ファイルに絞ることで、他タスクの正当な変更を副作用と誤検知させない（cross-task false positiveを防ぐ）。
   背景実行。完了通知で再開し verdicts を回収する（必要なら TaskOutput）。
- **最終判定はOpus自身**が握る。verdicts を踏まえ、自分でも `git diff` と対象ファイルを読んで採否を決める:
  - consensusMatch=false または high severity の乖離があれば、乖離箇所を特定 → (b)へ差し戻し設計と一致させる
  - codexの最終出力(.codex-out/<task-id>.md)とverdictsは参考。判定は実ファイルで行う
- 検証Workflowは read-only の逆検証のみ。編集はしない（編集は常にcodex）。

Tier B:
   軽ゲートとして plan.md の Verification に記載された test/build を実行し、Opus自身が `git diff` と対象ファイルを読んで採否を決める。Verification が無い、または Verification のコマンドが allowed-tools 許可外なら停止して人間へ返す。

Tier C:
   信頼 + Verification + branch-merge バリアの統合チェックのみを行い、Opus自身が `git diff` と対象ファイルを読んで採否を決める。branch-merge バリアは task-7 で導入済みの場合に使い、未導入なら作成せず dormant として扱う。Verification が無い、または Verification のコマンドが allowed-tools 許可外なら停止して人間へ返す。

差し戻し（各 attempt）は task-id / タスク種別 / Tier ごとに集計する。差し戻しは verdicts と `.codex-out` に既に記録されるため新規計測は不要で、loop 完了後に集計のみ行う。集計が「この種別は N attempt 連続で差し戻し0 → 格下げ可」を示す場合、報告質問として人間に返す。人間が承認した Tier 格下げは対象repoの `.claude/tier-policy.md` に永続化し、次回 goal の Tier 判定の初期値に使う。

## PR 作成
全タスクの実態検証が通ったら、plan.md の **## PR仕様** に従って PR を作成する（PR / スコープ単位）。PR 本文には必ず次を明記する:
- 本PRでの目的
- 満たすべき要件
- 着手前の立ち位置 / 完了後の立ち位置
- 作業フロー図（mermaid。本PRでの作業内容を図示）
- PR内で解決したタスクと、PR の goal への効果
- PR外への影響がある場合は、影響範囲とその影響（無ければ「なし」）
- その他共有事項

plan.md に PR仕様が無い場合は、上記項目を満たす本文を plan の実行計画から導出して作成する。base ブランチ・PR の向き先は plan / 各リポの運用制約に従う。破壊的・外向き操作（PR作成・マージ・ブランチ削除）は事前確認する。

## フォールバック
検証Workflowが利用不可/失敗した場合は、従来どおりClaude自身が `git diff` と対象ファイルを読んでplan設計と照合する。判定基準・差し戻し手順は不変。

## 中断条件
goalや要件に影響する想定外が発生したら、勝手に進めずユーザへ選択肢を提示して停止する。
plan.md に Verification が無い、または Verification のコマンドが allowed-tools 許可外の場合は、exec を停止して人間に返す。
