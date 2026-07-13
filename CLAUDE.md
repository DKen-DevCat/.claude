このファイルは全プロジェクト共通の「開発フロー正本」であり、フローの変更はここを唯一の反映点とする。各プロジェクト固有事項（ドメイン不変量・技術スタック・ディレクトリ責務・product の goal/plan）は各リポジトリの CLAUDE.md に置く。

## モデル台帳（モデル指定の単一の真実）

モデルは環境で入れ替わる。**モデル名を各所に散らさず、ここを唯一の参照点とする**。各 command / workflow / skill 本文は「セッションモデル」「Sonnet」等の**役割名**で書き、具体名はここだけに置く（モデル交代時の多ファイル修正を避ける）。

| 役割 | 現行の割当 | 置き場所 |
|---|---|---|
| orchestrator / 計画統合 / 最終判定 | **セッションモデル**（既定 = `settings.json` の `model`＝現行 `claude-fable-5[1m]`。`/model` 明示切替時はそれ） | `settings.json` `model` |
| 実装 subagent（1タスク=1 fresh subagent） | セッションモデル継承（`Agent` の既定） | — |
| 調査 / 逆検証 / レビュー / critic（worker・verifier） | **Sonnet**（`model:'sonnet'`＝最新 Sonnet に自動追従） | 各 workflow |

**degrade ladder（可用性）**: `claude-fable-5[1m]` は一時提供で、**約1週間後（〜2026-07-09 目安）に利用不可**になる見込み。**消滅時は `settings.json` の `model` を `claude-opus-4-8[1m]` に戻す**（＝新既定）。復活時は再度戻せる。goal コマンドは frontmatter に `model:` を書かずセッションモデルを継承するため、**この1点の切替で全 command / skill が追従する**。

## 役割反転フロー（v5・現行唯一）

分担: **Claude（orchestrator）= 設計・レビュー・検証の最終判定とオーケストレーション**、**実装・修正 = 実装 subagent（Claude・1タスク=1 fresh subagent）**、**人間 = ゴール設定と要件詰めのみ**。実装層は `Agent` の fresh subagent に一本化した（旧 codex は全廃、v3/v4 は `archive/goal-commands/` へ退役）。v4 までの制御（2トラック・Tier 勾配・commit-before-verify・コスト計測）は v5 が内包する（後述「## exec 制御」）。

orchestrator（セッションモデル）は、設計・レビュー・検証の最終判定を担当する。自分では実装の手を持たず（実装は fresh subagent に委譲）、計画・差し戻し判断・完了判定を握る。Workflow や sub-agent の出力は判断材料であり、最終判断そのものではない。

実装・修正は **fresh subagent（Claude・1タスク=1 subagent）** が担当する。承認済み plan.md の単一タスクを受け取り、対象ファイルと完了条件に沿って変更し、成果サマリを `.goalflow/out/<task-id>.md` に書く。毎タスク新鮮なコンテキストで始まるため後半潰れが起きず、harness 管理で完了通知が保証されるためハングのクラスも消える。

人間は、ゴール設定と要件詰めのみを担当する。実装判断を都度人間に戻すのではなく、goal や要件に影響する未確定事項が出た場合だけ選択を求める。

## モデル方針

具体的なモデル割当は「## モデル台帳」を唯一の参照点とする。ここには運用規律のみ置く:

- goal コマンドは frontmatter に `model:` を書かず、**セッションモデルを継承する**（ピンは `/model` 明示切替の経路を塞ぎ、mid-session のモデル切替で prompt cache を全壊するため）。
- command / workflow / skill 本文に具体的なモデル名を書かず、「セッションモデル」「Sonnet」等の役割名で書く（モデル交代時の多ファイル修正を避ける＝モデル台帳1点で追従）。
- 調査・逆検証・レビュー・critic は Sonnet を観点別に並列化し、抜けや設計不一致を構造化して返す（判断材料であり最終判断ではない）。
- 実装・修正は fresh subagent（Claude）を `Agent` で 1タスク=1 subagent として spawn し、harness 管理で完了通知を受ける。

## plan-exec 契約

承認済み plan.md が唯一の真実である。記載外の実装、リファクタ、追加調査、仕様変更は行わない。

`/goal:plan` は goal / なぜ / 要件 / 前提を固め、調査 Workflow の結果をオーケストレーターが統合して `docs/plans/<goal-slug>.md` を生成し、そこで必ず停止する。実装・ファイル編集・subagent への実装委譲は禁止する。plan.md の各タスクには `depends-on` / `target-files`（非 git 管理 target は `non-git: true`）を必須で持たせ、`## 並列バッチ構成` を出力する（exec はこれらフィールドからバッチを再導出して照合する）。

`/goal:exec-v5` は承認済み plan.md を真実として、task ごとに実装と検証を進める。plan が無ければ exec しない。

**1 タスク = 1 fresh subagent** とする。各タスク後に、対象ファイルに絞った `git diff` と実ファイルを読み、plan の設計4項目と照合する実態検証ゲートを必ず通す。

## exec 制御（v5・2トラック）

exec は単一タスク (a)明確化 →(b)実装 subagent →(c)検証 を基盤に次を載せる。実体は `commands/goal/exec-v5.md`（唯一の exec 正本）と `/loop` の2トラック。詳細は exec-v5.md §1-13 を正とし、ここは要点のみ:

- **2トラック**: `/loop`（interval 省略 = dynamic）が `/goal:exec-v5 <plan>` を fire して直列に自走する（subagent/verify の完了通知が primary wake、`ScheduleWakeup` は fallback heartbeat）。controller は独立バッチの worktree 並列と branch-merge バリアを担う。
- **commit-before-verify ＋ baseCommit**: subagent spawn 直前に `git rev-parse HEAD` で baseCommit を取り、タスク成果を per-task でコミットしてから、verify に `baseCommit` と `git diff baseCommit..HEAD` を渡す。verifier は真の task 差分のみを根拠にする（自前 git・独自 baseline は workflow 側で封じる）。
- **Tier 勾配（verify 深度専用）**: Tier A = フル3レンズ検証、B = build/test 軽ゲート + diff 精読、C = 統合チェックのみ。Tier は検証の深さのみを定め、**並列可否とは無関係**（並列可否は depends-on / target-files のみで判定・全 Tier が並列可 = exec-v5 §5）。
- **独立バッチ並列 ＋ branch-merge バリア**: **並列が既定**（plan.md の depends-on / target-files から独立バッチ =「depends-on なし ∧ target-files 互いに素」を導出。Tier とは無関係）。独立バッチを worktree+branch に分離して並列実行し、verified branch を `merge --no-ff` で1つずつ統合して各回統合チェックする。失敗は `git revert` / worktree 破棄で戻す（履歴は改変しない）。初回並列 run は canary 受け入れ条件付きで、失敗時は直列降格する（exec-v5 §6・§6.1）。
- **loop-until-done**: 全タスク完了まで主ループを回す。終了保証 = maxAttempts / maxRounds / no-progress。
- **ledger**: `.goalflow/state/<plan-slug>.json`（`.gitignore` 済・orchestrator 単独書込）で resume（exec-v5 §8）。
- **コスト計測**: workflow journal の totalTokens ＋ 実装 subagent トークン ＋ session usage を read-only で集計する。

## コマンド

`/goal:plan`: `~/.claude/commands/goal/plan.md`。調査と計画生成までを行い、実行せず停止する。

`/goal:exec-v5`: `~/.claude/commands/goal/exec-v5.md`。**唯一の exec 正本**。承認済み plan.md を真実として、Claude 一本化（1タスク=1 fresh subagent）で実装し、orchestrator（セッションモデル）が実態検証する controller。v4 §1-13 制御（2トラック・Tier 勾配・独立バッチ worktree 並列・branch-merge バリア・loop-until-done・commit-before-verify・コスト計測・ledger）を内包し、`/loop` 自走で **draft PR 作成まで無人終端**する。ledger（`.goalflow/state/<plan-slug>.json`）で resume する。

**退役（codex 全廃）**: 旧 `/goal:exec`(v3) / `/goal:exec-v4` は codex(gpt-5.5) 実装依存が非機能化し `archive/goal-commands/` へ退役（正本ではない・実行しない）。codex exec 有界化 hook も `hooks/archive/` へ退役し、`settings.json` の PreToolUse 登録も撤去済み。

設計・調査 Workflow は `~/.claude/workflows/goal-plan-investigate.workflow.js`。実装後の多視点逆検証 Workflow は `~/.claude/workflows/goal-exec-verify.workflow.js`。明示呼び出しの高品質レビューは `/deep-review`（skill）＋ `~/.claude/workflows/deep-review-engine.workflow.js`。

## 停止条件

goal や要件に影響する想定外が出たら、勝手に進めず、ユーザへ選択肢を提示して停止する。

破壊的・外向き操作は事前確認する。例: PR 作成、ブランチ削除、外部サービスへの変更反映、ネットワークを伴う依存追加。

**例外（v5 限定）**: `/goal:exec-v5` の自律 /loop に限り、全タスク verified ＋ 統合チェック通過後の**終端 draft PR 自動作成（当該作業ブランチへの `git push` を含む）**を事前確認なしで許可する。main への直接 merge・PR のマージ・履歴改変は引き続き禁止（draft → ready 化とマージは人間）。この緩和は exec-v5 限定で、他コマンド・他フローの「PR 作成は事前確認」原則は不変。

**permission ポリシー**: worktree 操作は全許可。**git 履歴改変（`reset --hard`・`branch -D`・force push・rebase・`commit --amend`）は一律禁止**。merge は許可するが、Claude が自律 merge してよいのは「並列作業の集約時」と「人間が明示的に PR番号 のマージを指示した時」のみ。**作業完了 → main への統合は必ず PR 経由**（main へ直接 merge しない）。rollback は `reset --hard` を使わず、失敗 worktree は `git worktree remove`＋必要なら `git revert`（履歴を改変しない）で戻す。これらは `settings.json` の deny でも多層に担保する。

検証で plan との乖離が見つかった場合は、乖離箇所を明示し、同じタスクの実装 subagent へ差し戻す（新しい fresh subagent を spawn＝コンテキストを持ち越さない）。plan 自体の変更が必要な場合は停止する。

## 各プロジェクトの Skills config

phase-* グローバル skill は、各プロジェクトの CLAUDE.md 内 `## Skills config` 直下にある最初の YAML フェンスを契約面として読む。project skill がある場合は global skill を上書きするが、Skills config はどの階層の skill からも参照される。

主なキーは `base_branch`、`branch_pattern`、`review_cmd`、`phase_registry`、`tasks_file`、`design_dir`、`commit_msg_hook_requires_tasks` などである。config 不在時は、`base_branch=develop`、`branch_pattern=feat/{phase-id}-{slug}`、`review_cmd=/code-review`、`phase_registry=.claude/plan.md`、`tasks_file=.claude/tasks.md`、`design_dir=.claude/design`、`commit_msg_hook_requires_tasks=true` を既定とする。`branch_pattern` のトークンは `{phase-id}`（フェーズID）と `{slug}`（kebab スラグ）で、skill が実値へ補間する。`review_cmd` は phase-review が起動するレビューコマンド（グローバル既定 `/code-review`。PJ ローカルの `/review-diff` 等を使う場合のみ上書き）。拡張キー `design_filename_pattern`（phase-kickoff）・`tasks_archive_dir`（phase-resume）も skill 側で参照される。

最小サンプル:

```yaml
phase:
  base_branch: develop
  branch_pattern: "feat/{phase-id}-{slug}"
  review_cmd: /code-review
  phase_registry: .claude/plan.md
  tasks_file: .claude/tasks.md
  design_dir: .claude/design
  commit_msg_hook_requires_tasks: true
```

## プロジェクト CLAUDE.md への要請

各プロジェクトの CLAUDE.md は、冒頭付近で「開発フローは本グローバル `~/.claude/CLAUDE.md` と `/goal:plan`・`/goal:exec-v5` を正本とする」旨の必読ポインタを必ず張る。

これはグローバル CLAUDE.md が自動ロードされるか否かに関わらず明記する。プロジェクト固有の CLAUDE.md は、フロー本体を再定義せず、固有の制約・責務・参照資料だけを保持する。
