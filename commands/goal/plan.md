---
description: goalの実現可能性を調査し、レビュー用の計画mdを生成する（実行はしない）
argument-hint: <goal-slug>
allowed-tools: Read, Grep, Glob, Bash(git log:*), Bash(git diff:*), Write, Workflow, TaskOutput, TaskGet, Agent, Skill, AskUserQuestion
---
あなたはオーケストレーターです。ultrathinkで臨んでください。
このコマンドは**調査と計画の生成までで必ず停止**します。
いかなる実装・プロダクションコード編集・subagent への実装委譲も禁止です（生成物は plan.md のみ）。

## 入力
ユーザが対話で渡す: goal / なぜ必要か / 要件 / 把握している前提情報

## 手順
1. **対話intake**: goal / なぜ / 要件 / 前提 をユーザと固める。
   Workflowは背景・非対話で実行されるため、起動前にここで入力を確定する。
   goal が曖昧な場合は、この intake 段でも `Skill(dme)` を起動し枠組み（初期スコープ・前提）を構造化してから investigation を起動してよい。
2. **調査Workflowを起動**（調査を多エージェント並列fan-outに委譲）:
   Workflowツールを次で呼ぶ —
     scriptPath: /Users/ooizumiyou/.claude/workflows/goal-plan-investigate.workflow.js
     args: { goal, why, requirements, context, cwd: <現在の作業ディレクトリの絶対パス> }
   背景実行。task IDが返る（/workflows で進捗確認可）。このターンは一旦ここで終わる。
3. **完了通知で再開したら**、Workflowの構造化結果（findings / critic）を回収する
   （必要なら TaskOutput で取得）。critic は視点分散の多票判定（coverage/grounding/risk）。
   Workflow は十分性を確定しない。`critic.unresolvedHighGaps`（残存する blocking な抜け）があれば、
   オーケストレーターはそれを Read/Grep 等で自分で埋めて済ませず、手順4/5の dme ⚖️moat と同列に扱い、
   「## 未確定・要判断事項」の ⚖️ として人間に返す（dme: 確定は人間に返す。auto-close しない）。
   `critic.consensusComplete=true` は high gap ゼロによる収束を意味する。この場合でも、high 以外の
   `critic.missingAngles` / `critic.suggestedFollowups` の薄い観点（low/medium）は、必要に応じて
   Read/Grep 等でオーケストレーターが補完してよい。後方互換として、`critic.consensusComplete=false` や
   `critic.missingAngles` の従来参照も残しつつ、high gap は `critic.unresolvedHighGaps` を優先して
   ⚖️ に回す。
4. **オーケストレーターが `Skill(dme)` を起動し、ギャップ特定と計画作文（構造判断）を dme に委譲する**（dme をコピーせず必ず Skill 経由で呼ぶ。dme は進化するため更新を自動反映させる）:
   - findings / critic を素材に dme ループを回す。②推測を主に、①観察・③照合は findings に対して行い、現状と goal のギャップを特定する。dme は自走で構造（タスク構造・PR境界）と ⚖️moat を返す。
   - dme には、競合する設計候補 / PR境界候補を最低2案出すことを必須要求する。単一解が妥当な場合は、その理由を明記させる。
   - 候補が複数ある場合のみ、設計候補 / PR境界候補にペア比較トーナメントを回す。候補を2つずつ比較し、実行級の比較（正しさ・きれいさ・idiomatic さ）では勝者を champion として採用する。候補が単一ならこの段はスキップし、比較手順を空振りさせない。
   - ただし、候補が異なる評価軸で勝つ基準級の分岐の場合は champion を強制せず、その分岐を ⚖️ として「## 未確定・要判断事項」へ直列化する（dme の ③基準 moat を保持）。
   - dme 出力 → 本コマンドの出力 schema へのマッピング:
     - dme②推測（構造・流れの仮説）→ 「## 実行計画」のタスク群 と 「## PR仕様」の PR 境界
     - dme⚖️moat（①どこを切る / ③何を基準にズレを見る）→ 「## 未確定・要判断事項」
     - dme③照合 → findings / critic との突き合わせ（「## 調査結果」のギャップの根拠付け）
   - goal到達に必要な要素を、タスクごとに4項目で書き出す:
     操作対象 / 操作内容 / 影響場所と効果 / goalへの影響
   - dme には、**タスク間依存（depends-on）と target-files（そのタスクが変更するファイルパス集合）の抽出・宣言**を必須要求する。全タスクについて、依存先 task-id（無ければ空配列）と変更対象パスを漏れなく特定させる（/goal:exec-v5 の独立バッチ導出「depends-on なし ∧ target-files 互いに素」の判定材料になるため、省略不可）。gitignored 等の非 git 管理 target を持つタスクはその旨も特定させる。
5. dme が出した ⚖️moat（判断が割れる分岐）は決めず「未確定・要判断事項」に選択肢として直列化する。ただし goal / 要件に効く高stakesの ⚖️ は、plan.md 確定前に `AskUserQuestion` で確認してから作文する（hybrid）。
6. 実行計画を **PR / スコープ単位** に束ねる。この PR / スコープの分割は dme の「① どこを切るか」judgment そのものであり、手順4の `Skill(dme)` ループの産物として導く。分割候補が複数ある場合は手順4と同じペア比較トーナメントを回し、実行級の比較では champion を採用する。基準級の分岐では champion を強制せず、分割の根拠・代替案とともに ⚖️ で開示し、「未確定・要判断事項」へ直列化する。各 PR の **PR仕様** を設計する:
   目的 / 満たすべき要件 / 着手前の立ち位置・完了後の立ち位置 /
   作業フロー図（mermaid）/ 解決タスクと goal への効果 /
   PR外への影響（影響範囲と影響、無ければ「なし」）/
   Verification（検証コマンド。build/test。共通の build/test が無い repo では「なし（または手レビュー）」と明記可）/ その他共有事項。
   この PR仕様は /goal:exec-v5 が PR 本文を書く際の唯一の根拠になるため、plan 段階で確定させる。

## 出力
`docs/plans/$ARGUMENTS.md` に下記構造で書き出して**ターンを終了**する:

# Goal: ...
## 背景（なぜ / 要件 / 前提）
## 調査結果（goal実態 / 現状実態 / ギャップ）
## 実行計画
- [ ] task-1
  - 操作対象:
  - target-files: [相対パス...]（**必須**。そのタスクが変更するファイルパス集合。バッチ間の互いに素判定に使う）
  - depends-on: [task-id...]（**必須**。依存先 task-id。空配列 = 依存なし）
  - 操作内容:
  - 影響場所と効果:
  - goalへの影響:

  gitignored 等の非 git 管理 target を持つタスクには、depends-on の直後に `non-git: true` を必ず付す（commit/worktree/バリア対象外の直列扱いになる）。
## 並列バッチ構成
（depends-on / target-files から導出したトポロジカル層のバッチ表。初回並列 run の canary バッチを明示する。
/goal:exec-v5 はフィールドから再導出して照合し、不一致なら停止する）

| バッチ | タスク | 実行様式 | 根拠 |
|---|---|---|---|
## 未確定・要判断事項
## PR仕様（PR / スコープごと。/goal:exec-v5 はこの仕様どおりに PR 本文を書く）
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
  - Verification: 検証コマンド（build/test）。無ければ /goal:exec-v5 は停止する。共通の build/test が無い repo では「なし（または手レビュー）」と明記可。
  - その他共有事項:

最後に「plan.md を確認・編集のうえ /goal:exec-v5 を実行してください」と伝えて停止する。

## フォールバック
Workflowが利用不可/失敗した場合は、従来どおり調査を Sonnet（CLAUDE.md モデル台帳の worker/verifier モデル）の sub-agent に
並列・read-onlyで委譲（または自分で調査）して計画を作る。停止条件・出力構造は不変。
