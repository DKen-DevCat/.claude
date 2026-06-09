このファイルは全プロジェクト共通の「開発フロー正本」であり、フローの変更はここを唯一の反映点とする。各プロジェクト固有事項（ドメイン不変量・技術スタック・ディレクトリ責務・product の goal/plan）は各リポジトリの CLAUDE.md に置く。

## 役割反転フロー（v4）

Claude(Opus)=設計・レビュー・検証の最終判定、Codex(gpt-5.5)=実装・修正、人間=ゴール設定と要件詰めのみ、を基本分担とする。v4 では exec 側に「2トラック制御（/loop 直列自走 ＋ controller 並列）」「Tier 勾配」「commit-before-verify」「コスト計測」を加える（後述「## v4 exec 制御（2トラック）」）。役割分担そのものは v3 と不変。

Claude（Opus）は、設計・レビュー・検証の最終判定を担当する。実装の手は持たず、計画、差し戻し判断、完了判定を握る。

Codex（gpt-5.5）は、実装・修正を担当する。承認済み plan.md で定義された単一タスクを受け取り、対象ファイルと完了条件に沿って変更する。

人間は、ゴール設定と要件詰めのみを担当する。実装判断を都度人間に戻すのではなく、goal や要件に影響する未確定事項が出た場合だけ選択を求める。

## モデル方針

オーケストレーター、計画統合、最終判定は Opus が担当する。Workflow や sub-agent の出力は判断材料であり、最終判断そのものではない。

調査・逆検証・レビュー・critic は Sonnet が担当する。観点別に並列化して、抜けや設計不一致を構造化して返す。

実装・修正は Codex(gpt-5.5 / xhigh) が担当する。Codex は Workflow 内に入れず、top-level の同期実行として 1 タスクずつ呼び出す。

## plan-exec 契約

承認済み plan.md が唯一の真実である。記載外の実装、リファクタ、追加調査、仕様変更は行わない。

`/goal:plan` は goal / なぜ / 要件 / 前提を固め、調査 Workflow の結果を Opus が統合して `docs/plans/<goal-slug>.md` を生成し、そこで必ず停止する。実装・ファイル編集・Codex 呼び出しは禁止する。

`/goal:exec` は承認済み plan.md を真実として、task ごとに実装と検証を進める。plan が無ければ exec しない。

1 タスク = 1 Codex 呼び出しとする。各タスク後に、対象ファイルに絞った `git diff` と実ファイルを読み、plan の設計4項目と照合する実態検証ゲートを必ず通す。

## v4 exec 制御（2トラック）

exec は v3 の単一タスク (a)明確化 →(b)Codex →(c)検証 を基盤に、次を載せる。置き場所は `commands/goal/exec.md`（v3）を編集せず（編集は却下済み）、新規 controller `commands/goal/exec-v4.md` と `/loop` の2トラックに分ける。

- **2トラック**: `/loop`（interval 省略 = dynamic）が `/goal:exec-v4 <plan>` を fire して直列に自走する（codex/verify の完了通知が primary wake、`ScheduleWakeup` は fallback heartbeat）。controller は独立バッチの worktree 並列と branch-merge バリアを担う。
- **commit-before-verify ＋ baseCommit**: codex 実行直前に `git rev-parse HEAD` で baseCommit を取り、タスク成果を per-task でコミットしてから、verify に `baseCommit` と `git diff baseCommit..HEAD` を渡す。verifier は真の task 差分のみを根拠にする（自前 git・独自 baseline は workflow 側で封じる）。
- **Tier 勾配**: Tier A = フル3レンズ検証、B = build/test 軽ゲート + diff 精読、C = 統合チェックのみ。初回から「target 互いに素 ∧ 依存なし ∧ テスト被覆ありの低リスク」を Tier B/C と自然判定してよい（dormant を待たない）。
- **独立バッチ並列 ＋ branch-merge バリア**: 独立バッチを worktree+branch に分離して並列実行し、verified branch を `merge --no-ff` で1つずつ統合して各回統合チェックする。失敗は `git revert` / worktree 破棄で戻す（履歴は改変しない）。
- **loop-until-done**: 全タスク完了まで主ループを回す。終了保証 = maxAttempts / maxRounds / no-progress。
- **コスト計測**: workflow journal の totalTokens ＋ codex usage ＋ session usage を read-only で集計する。

## コマンド

`/goal:plan`: `~/.claude/commands/goal/plan.md`。調査と計画生成までを行い、実行せず停止する。

`/goal:exec`: `~/.claude/commands/goal/exec.md`。承認済み plan.md を唯一の真実として Codex に実装を委譲し、Opus が実態検証する（v3・単一タスク直列）。

`/goal:exec-v4`: `~/.claude/commands/goal/exec-v4.md`。v3 を基盤に v4 制御（2トラック・Tier 勾配・独立バッチ worktree 並列・branch-merge バリア・loop-until-done・commit-before-verify・コスト計測）を載せた controller。`/loop` から自走起動する想定。`exec.md`(v3) は不変。

設計・調査 Workflow は `~/.claude/workflows/goal-plan-investigate.workflow.js` を使う。実装後の多視点逆検証 Workflow は `~/.claude/workflows/goal-exec-verify.workflow.js` を使う。

## 停止条件

goal や要件に影響する想定外が出たら、勝手に進めず、ユーザへ選択肢を提示して停止する。

破壊的・外向き操作は事前確認する。例: PR 作成、ブランチ削除、外部サービスへの変更反映、ネットワークを伴う依存追加。

**permission ポリシー（v4）**: worktree 操作は全許可。**git 履歴改変（`reset --hard`・`branch -D`・force push・rebase・`commit --amend`）は一律禁止**。merge は許可するが、Claude が自律 merge してよいのは「並列作業の集約時」と「人間が明示的に PR番号 のマージを指示した時」のみ。**作業完了 → main への統合は必ず PR 経由**（main へ直接 merge しない）。rollback は `reset --hard` を使わず、失敗 worktree は `git worktree remove`＋必要なら `git revert`（履歴を改変しない）で戻す。これらは `settings.json` の deny でも多層に担保する。

検証で plan との乖離が見つかった場合は、乖離箇所を明示し、同じタスクの Codex 実行へ差し戻す。plan 自体の変更が必要な場合は停止する。

## 各プロジェクトの Skills config

phase-* グローバル skill は、各プロジェクトの CLAUDE.md 内 `## Skills config` 直下にある最初の YAML フェンスを契約面として読む。project skill がある場合は global skill を上書きするが、Skills config はどの階層の skill からも参照される。

主なキーは `base_branch`、`branch_pattern`、`phase_registry`、`tasks_file`、`design_dir`、`commit_msg_hook_requires_tasks` などである。config 不在時は、`base_branch=develop`、`phase_registry=.claude/plan.md`、`tasks_file=.claude/tasks.md`、`design_dir=.claude/design`、`commit_msg_hook_requires_tasks=true` を既定とする。

最小サンプル:

```yaml
phase:
  base_branch: develop
  branch_pattern: "phase/{slug}"
  phase_registry: .claude/plan.md
  tasks_file: .claude/tasks.md
  design_dir: .claude/design
  commit_msg_hook_requires_tasks: true
```

## プロジェクト CLAUDE.md への要請

各プロジェクトの CLAUDE.md は、冒頭付近で「開発フローは本グローバル `~/.claude/CLAUDE.md` と `/goal:plan`・`/goal:exec` を正本とする」旨の必読ポインタを必ず張る。

これはグローバル CLAUDE.md が自動ロードされるか否かに関わらず明記する。プロジェクト固有の CLAUDE.md は、フロー本体を再定義せず、固有の制約・責務・参照資料だけを保持する。
