---
description: goalの実現可能性を調査し、レビュー用の計画mdを生成する（実行はしない）
argument-hint: <goal-slug>
model: claude-opus-4-8
allowed-tools: Read, Grep, Glob, Bash(git log:*), Bash(git diff:*), Write, Workflow, TaskOutput, TaskGet, Task
---
あなたはオーケストレーターです。ultrathinkで臨んでください。
このコマンドは**調査と計画の生成までで必ず停止**します。
いかなる実装・ファイル編集・codex呼び出しも禁止です。

## 入力
ユーザが対話で渡す: goal / なぜ必要か / 要件 / 把握している前提情報

## 手順
1. **対話intake**: goal / なぜ / 要件 / 前提 をユーザと固める。
   Workflowは背景・非対話で実行されるため、起動前にここで入力を確定する。
2. **調査Workflowを起動**（調査を多エージェント並列fan-outに委譲）:
   Workflowツールを次で呼ぶ —
     scriptPath: /Users/ooizumiyou/.claude/workflows/goal-plan-investigate.workflow.js
     args: { goal, why, requirements, context, cwd: <現在の作業ディレクトリの絶対パス> }
   背景実行。task IDが返る（/workflows で進捗確認可）。このターンは一旦ここで終わる。
3. **完了通知で再開したら**、Workflowの構造化結果（findings / critic）を回収する
   （必要なら TaskOutput で取得）。critic.suggestedFollowups に薄い観点があれば
   Read/Grep 等で自分で軽く補完してよい。
4. **Opus自身がギャップ特定と計画作文を行う**（Workflowは調査のみ。計画と判断はClaudeが握る）:
   - findings / critic を素材に、現状とgoalのギャップを特定する
   - goal到達に必要な要素を、タスクごとに4項目で書き出す:
     操作対象 / 操作内容 / 影響場所と効果 / goalへの影響
5. 判断が割れる分岐は決めず「未確定・要判断事項」に選択肢として列挙する
6. 実行計画を **PR / スコープ単位** に束ね、各 PR の **PR仕様** を設計する:
   目的 / 満たすべき要件 / 着手前の立ち位置・完了後の立ち位置 /
   作業フロー図（mermaid）/ 解決タスクと goal への効果 /
   PR外への影響（影響範囲と影響、無ければ「なし」）/ その他共有事項。
   この PR仕様は /goal:exec が PR 本文を書く際の唯一の根拠になるため、plan 段階で確定させる。

## 出力
`docs/plans/$ARGUMENTS.md` に下記構造で書き出して**ターンを終了**する:

# Goal: ...
## 背景（なぜ / 要件 / 前提）
## 調査結果（goal実態 / 現状実態 / ギャップ）
## 実行計画
- [ ] task-1
  - 操作対象:
  - 操作内容:
  - 影響場所と効果:
  - goalへの影響:
## 未確定・要判断事項
## PR仕様（PR / スコープごと。/goal:exec はこの仕様どおりに PR 本文を書く）
- PR-1: <対象リポジトリ / スコープ>
  - 目的: 本PRで達成すること
  - 満たすべき要件:
  - 着手前の立ち位置 / 完了後の立ち位置:
  - 作業フロー図（mermaid。本PRでの作業内容を図示）:
    ```mermaid
    flowchart TD
      A[着手前の状態] --> B[作業1] --> C[作業2] --> D[完了後の状態]
    ```
  - 解決タスクと goal への効果: 本PR内で解決する実行計画タスクと、PR goal への効果
  - PR外への影響: 影響範囲と影響（無ければ「なし」）
  - その他共有事項:

最後に「plan.md を確認・編集のうえ /goal:exec を実行してください」と伝えて停止する。

## フォールバック
Workflowが利用不可/失敗した場合は、従来どおり調査を sonnet 4.6 のsub-agentに
並列・read-onlyで委譲（または自分で調査）して計画を作る。停止条件・出力構造は不変。
