このファイルは全プロジェクト共通の「開発フロー正本」であり、フローの変更はここを唯一の反映点とする。各プロジェクト固有事項（ドメイン不変量・技術スタック・ディレクトリ責務・product の goal/plan）は各リポジトリの CLAUDE.md に置く。

## 役割反転フロー（v5）

Claude=設計・レビュー・検証の最終判定とオーケストレーション、実装・修正=実装 subagent（Claude・1タスク=1 fresh subagent）、人間=ゴール設定と要件詰めのみ、を基本分担とする。**v5 で実装層を Claude 一本化し（codex 全廃）**、orchestrator は Fable 5、実装は `Agent` の fresh subagent に委譲する（コマンドは後述「## コマンド」の `/goal:exec-v5`）。v4 までの「2トラック制御（/loop 直列自走 ＋ controller 並列）」「Tier 勾配」「commit-before-verify」「コスト計測」は v5 がそのまま内包する（後述「## v4 exec 制御（2トラック）」）。**v3/v4 は移行期間中のみ Codex(gpt-5.5) を実装に使う**。役割分担そのものは v3 から不変。

Claude（orchestrator・Fable 5）は、設計・レビュー・検証の最終判定を担当する。自分では実装の手を持たず（実装は fresh subagent に委譲）、計画、差し戻し判断、完了判定を握る。

実装・修正は **fresh subagent（Claude・1タスク=1 subagent）** が担当する。承認済み plan.md で定義された単一タスクを受け取り、対象ファイルと完了条件に沿って変更し、成果サマリを `.codex-out/<task-id>.md` に書く。毎タスク新鮮なコンテキストで始まるため、長期タスクでの後半潰れが起きない。**v3/v4 では同じ役割を Codex(gpt-5.5) が担う**（移行期間）。

人間は、ゴール設定と要件詰めのみを担当する。実装判断を都度人間に戻すのではなく、goal や要件に影響する未確定事項が出た場合だけ選択を求める。

## モデル方針

オーケストレーター、計画統合、最終判定は**セッションモデル**が担当する（既定 = settings.json の `claude-fable-5[1m]`。`/model claude-opus-4-8` の明示切替時は Opus 4.8）。goal コマンドは frontmatter に `model:` を書かず、セッションモデルを継承する（ピンは明示切替の経路を塞ぎ、mid-session のモデル切替で prompt cache を全壊するため。v3 `exec.md` / v4 `exec-v4.md` の opus ピンのみ移行期間の凍結経路として例外）。Workflow や sub-agent の出力は判断材料であり、最終判断そのものではない。

調査・逆検証・レビュー・critic は Sonnet が担当する。観点別に並列化して、抜けや設計不一致を構造化して返す。

実装・修正は **fresh subagent（Claude）** が担当する（v5）。`Agent` tool で 1 タスク = 1 subagent を spawn し、harness 管理で完了通知を受ける（外部プロセスでないためハングのクラスが消える）。**v3/v4 では Codex(gpt-5.5 / xhigh) が担当**し、Codex は Workflow 内に入れず、top-level の同期実行として 1 タスクずつ呼び出す（移行期間）。

## plan-exec 契約

承認済み plan.md が唯一の真実である。記載外の実装、リファクタ、追加調査、仕様変更は行わない。

`/goal:plan` は goal / なぜ / 要件 / 前提を固め、調査 Workflow の結果を Opus が統合して `docs/plans/<goal-slug>.md` を生成し、そこで必ず停止する。実装・ファイル編集・Codex 呼び出しは禁止する。

`/goal:exec` は承認済み plan.md を真実として、task ごとに実装と検証を進める。plan が無ければ exec しない。

1 タスク = 1 Codex 呼び出しとする。各タスク後に、対象ファイルに絞った `git diff` と実ファイルを読み、plan の設計4項目と照合する実態検証ゲートを必ず通す。

### codex 呼び出しの堅牢化（PreToolUse hook）【v3/v4 移行期間のみ・v5 では不要】
**v5（`/goal:exec-v5`）は codex を使わないため、この hook は v5 経路には無関係**（fresh subagent は harness 管理で hang のクラスが消える）。v3/v4 が codex exec を使う移行期間中のみ本 hook は有効で、**hook の物理撤去は codex 解約と同期する**（撤去しても v5 の Bash 経路は fail-open で素通りするため実害なし）。以下は v3/v4 向けの説明: codex exec は、グローバル PreToolUse hook `~/.claude/hooks/codex-exec-guard.sh`（`~/.claude/settings.json` に登録）により実行直前に **wall-clock 有界化** される。GNU `timeout`/`gtimeout` を優先し（coreutils 導入済み）、実行環境に `timeout`/`gtimeout` が無い場合のみ `perl` fork/alarm ラッパーにフォールバックして、`hookSpecificOutput.updatedInput` で command を rewrite し既定 300s に bound する。hang/timeout（exit 124）や rate-limit（TPM/RPM 枯渇）が疑われる時は、hook が `additionalContext` で注入する degrade ladder（reasoning effort xhigh→high→medium / 2〜3 ファイルにチャンク / `service_tier="priority"` 除去 / 最終手段 Opus 直接）に従う。これにより `exec.md` を無編集のまま、全 session で codex の無限 hang を有界 fail-fast に置換する。根因・設計は `~/.claude/docs/plans/goal-exec-codex-large-task-hang.md`、実測の切り分けは memory `feedback_codex_ratelimit_hang` を参照。

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

`/goal:exec-v5`: `~/.claude/commands/goal/exec-v5.md`。承認済み plan.md を唯一の真実として、**Claude 一本化（codex 全廃・1タスク=1 fresh subagent）**で実装し、orchestrator(Fable 5) が実態検証する controller。v4 §1-13 制御を内包し、実装層だけを Codex から `Agent`(fresh subagent) に差し替え、`/loop` 自走で **draft PR 作成まで無人終端**する。codex を使わないため harness が完了通知を保証し、ハングのクラスが消える。ledger（`.goalflow/state/<plan-slug>.json`・orchestrator 単独書込）で resume する。`exec.md`(v3)/`exec-v4.md` は不変。

`/goal:viz`: `~/.claude/commands/goal/viz.md`。承認済み plan の tasks.json（`docs/viz/SCHEMA.md` 準拠）と 3 観測 seam（.codex-out / git commit / verify journal）を融合し、dagre-d3 の固定資産 renderer で実行状態オーバーレイ付き DAG をブラウザ表示する read-only 可視化。中核ロジックは外付けスキル `~/.claude/skills/goalflow-viz/`（fuse.mjs / renderer.html / watch.sh）に置き、コア（exec.md / exec-v4.md / plan.md のフロー本体）は再定義しない。`/goal:viz <slug> --watch` で L1+file-watch 自動リフレッシュ。

設計・調査 Workflow は `~/.claude/workflows/goal-plan-investigate.workflow.js` を使う。実装後の多視点逆検証 Workflow は `~/.claude/workflows/goal-exec-verify.workflow.js` を使う。

## 停止条件

goal や要件に影響する想定外が出たら、勝手に進めず、ユーザへ選択肢を提示して停止する。

破壊的・外向き操作は事前確認する。例: PR 作成、ブランチ削除、外部サービスへの変更反映、ネットワークを伴う依存追加。

**例外（v5 限定）**: `/goal:exec-v5` の自律 /loop に限り、全タスク verified ＋ 統合チェック通過後の**終端 draft PR 自動作成（当該作業ブランチへの `git push` を含む）**を事前確認なしで許可する。main への直接 merge・PR のマージ・履歴改変は引き続き禁止（draft → ready 化とマージは人間）。この緩和は exec-v5 限定で、他コマンド・他フローの「PR 作成は事前確認」原則は不変。

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
