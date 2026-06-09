# Goal: 開発フロー設定を global に一任し、各pjは project固有のみを残す（web_mental-model-space / nestify / todo）

> 生成: 2026-05-31 / `/goal:plan` 調査フェーズ（Workflow: goal-plan-investigate, 3 agents, 281k tok）+ Opus による実ファイル検証。
> 本コマンドは計画生成で停止済み。実装は `/goal:exec` で行う（本ファイルが唯一の真実）。

---

## 背景（なぜ / 要件 / 前提）

### なぜ
開発フローが各pjに bespoke に散在している。特に **web_mental-model-space (P1)** には旧 v3 自動開発フロー一式（`scripts/orchestrate-scope.mjs` 1561行・`design-pipeline.mjs`・project-/worker-* skills・`AGENTS.md`・`docs/orchestrator/runbook.md`・`docs/automation-review-loop-design.md`・CLAUDE.md の「自動開発フロー(v3)」節）が残存する。これらは **global の `goal:plan`/`goal:exec` フロー（codex exec を直接駆動する自己完結型）に実質置換済み**にも関わらず生きており、(1) フロー変更が全pjに波及しない、(2) global/project の責務境界が曖昧、(3) 二重管理で保守性が低い、という問題を生んでいる。globalを正本化すれば一箇所の変更で全pjに反映でき、project側はドメイン固有のみに集中できる。

### 要件（ユーザ確定事項）
1. **旧フロー資産 = 完全移行・削除**し、global `goal:*` に一本化する。
2. **共有フロー記述**（役割反転 / モデル方針 / plan-exec契約 / 停止条件）は **`~/.claude/CLAUDE.md` を新設**して集約。各pj CLAUDE.md は project固有（4不変量 / 技術スタック / ディレクトリ責務 / product の goal・plan）のみ。
3. **codex**: global（`~/.codex/config.toml`, `~/.codex/rules/default.rules`）は model/sandbox/approval/trust 等の**汎用のみ**残し、pj固有 rules は project-local へ分離。
4. **対象は P1 / nestify(P2) / todo(P3) の3pjのみ**。
5. **実行フェーズでは各ターゲットを base から新規ブランチで切り、PR作成まで**進める（本planでは実装しない）。
6. 真に project固有なもの（P1: project-governance skill, scenes形式, verify-*.mjs / P2: check/dev-restart/review-diff, code-* agents / P3: go-* agents）は各pjに残す。

### 前提（確認済みの実態）
- **global 正本（既設）**: `~/.claude/commands/goal/{plan,exec}.md`、`~/.claude/workflows/goal-{plan-investigate,exec-verify}.workflow.js`、`~/.claude/skills/{phase-kickoff,phase-resume,phase-review,phase-ship,phase-spec,skill-creator}`、`~/.claude/settings.json`。**`~/.claude/CLAUDE.md` は未存在**。
- **global `goal:*` は `orchestrate-scope.mjs` を一切参照しない**自己完結型（codex exec --model gpt-5.5 を直接コマンド実行）。旧フローとは完全に別系統。
- **phase-* skill は CLAUDE.md 内の `## Skills config` 直下の最初の YAML を契約面として読む**（base_branch / phase_registry / tasks_file / design_dir / commit_msg_hook_requires_tasks 等）。config 不在時は既定値（base_branch=develop, phase_registry=`.claude/plan.md` 等）。
- **PR可否（実行構造）**: global `~/.claude` は remote あり base=**main**（develop無し）→ main向けPR。P1/P2/P3 はいずれも base=**develop** → develop向けPR。
  - P1 remote: `DKen-DevCat/web_mental-model-space` / P2: `DKen-DevCat/nestify` / P3: `DKen-DevCat/goal-navigator`。
- **責務境界の原則**（本計画の判定基準）:
  - **global = HOW（フロー）**: goal:*/phase-*/skill-creator、共有 CLAUDE.md、汎用 settings・codex config。
  - **project = WHAT（ドメイン）**: 各pj CLAUDE.md のドメイン記述 + 小さな `## Skills config` 配線、tech固有 skill/agent、product docs/code。

---

## 調査結果（goal実態 / 現状実態 / ギャップ）

### goal実態（あるべき姿 = global 正本）
global `goal:plan` → `goal-plan-investigate.workflow.js`（goal/current 並列probe + critic）→ Opus が `docs/plans/*.md` 作文。global `goal:exec` → 1task=1 `codex exec`（gpt-5.5, sandbox workspace-write）→ `goal-exec-verify.workflow.js`（design-match / side-effects / completion の3レンズ逆検証）→ Opus 最終判定。phase-* はライフサイクル補助で、各pj CLAUDE.md の `## Skills config` で配線。これが全pj共通の「正本」。

### 現状実態（pjごとに大きく異なる）
- **P1 web_mental-model-space**: 旧 v3 フローが丸ごと現存。CLAUDE.md 行101（自動開発フロー節）＋行140-152（必須参照節）が削除対象ファイル群を「毎セッション必読」として指し続けている。`AGENTS.md` 行21/81-82 が `orchestrate-scope.mjs` と相互参照。**CLAUDE.md に `## Skills config` ブロックが無く**、phase-* が既定 `phase_registry=.claude/plan.md` を見るが実体は `docs/plan.md` で**不一致**。`goal:*` 参照も無い。
- **P2 nestify**: 最も統合が進む。develop に **`## Skills config` ブロック実装済**（base_branch=develop / phase_registry=.claude/plan.md / tasks_file=.claude/tasks.md / design_dir=.claude/design / commit_msg_hook_requires_tasks=true / review.* / skills.* local宣言）。**phase-* の project-local 版は develop で削除済（global委譲済）**。check/dev-restart/review-diff 等は tech固有として正しく local 維持。**未配線は CLAUDE.md 本体への `goal:*` ポインタのみ**。`chore/globalize-phase-skills` / `chore/claude-config-refactor` は **develop に対し 0 unique commit の stale ブランチ**（マージ済）。
- **P3 todo (goal-navigator)**: 最軽量。Go TUI。`.claude/agents/{go-code-reviewer,go-perf-analyzer,go-test-architect}` のみ。**`## Skills config` 無し**（global phase-* 未接続）、`goal:*` 参照無し、`.codex` 無し。**`~/.codex/config.toml` の trust_level に todo パス未登録**（codex exec 時に認証発生の懸念）。旧フロー資産は皆無。
- **codex global**: `~/.codex/rules/default.rules` 41エントリのうち **約37件が P1固有**（PORT=3107/3001, HOST=127.0.0.1, `lsof -ti tcp:5173`, `pnpm -F server dev`, `pnpm orchestrate`, `pnpm verify:r3f`, 特定PIDの `kill`, インライン playwright スクリプト, 絶対パス付き `pnpm --store-dir ...`）。真に汎用は `git add` / `git switch -c` / `git commit` / `codex exec` の4件程度。P2/P3 で codex を走らせると P1固有 allow が誤適用され、P2/P3固有コマンドは未許可になる誤挙動リスク。project-local `.codex` は3pj全てに無い。

### ギャップ（goal − 現状）
| # | ギャップ | 対応グループ |
|---|---------|------------|
| g1 | 共有フロー正本 `~/.claude/CLAUDE.md` が存在しない | A |
| g2 | `default.rules` が P1固有で汚染、汎用境界が未分離 | A |
| g3 | todo が codex trust 未登録 | A |
| g4 | P1 CLAUDE.md が旧フロー資産を必読指定し続けている（削除の前提配線） | B |
| g5 | P1 旧フロー資産が実体として残存（閉じた参照グラフ） | B |
| g6 | P1 CLAUDE.md に `## Skills config` 無し → phase_registry 不一致 | B |
| g7 | P1固有 codex rules の移管/破棄先が未定 | B |
| g8 | P1 に `docs/plans/` が無い（goal:plan 出力先） | B |
| g9 | P2 CLAUDE.md に `goal:*` ポインタ未追加 | C |
| g10 | P2 stale ブランチ2本が残置 | C |
| g11 | P3 CLAUDE.md に `## Skills config` + `goal:*` 配線が無い | D |
| g12 | P3 phase_registry/tasks_file の実体・`docs/plans/` が無い | D |

---

## 実行計画

> 実行構造: ターゲット単位（global / P1 / P2 / P3）に **base から新規ブランチ → コミット → PR**。global base=main, P1/P2/P3 base=develop。
> 安全順序: **参照の書き換え（CLAUDE.md/AGENTS）を先、ファイル削除を後**。global 正本（A1）を先に置いてから各pjがそれを指す。

### グループA — global 正本整備（リポ: `~/.claude`, 設定: `~/.codex`）

- [ ] **A1. `~/.claude/CLAUDE.md` を新設（共有フロー契約の正本）**
  - 操作対象: `~/.claude/CLAUDE.md`（新規）
  - 操作内容: 役割反転契約（Claude/Opus=設計・検証判定、Codex/gpt-5.5=実装）／モデル方針（Opus=計画統合・最終判定、Sonnet=調査・逆検証、gpt-5.5=実装）／plan-exec契約（planが唯一の真実・1task=1codex・per-task gate）／停止条件（想定外はユーザへ選択肢提示で停止）／`goal:plan`・`goal:exec` コマンドへのポインタ／各pj CLAUDE.md に置く `## Skills config` YAML 記法の説明、を簡潔に記述。素材は `~/.claude/docs/phase-flow-comparison.md` と `~/.claude/docs/plans/goal-workflow-integration.md`。
  - 影響場所と効果: 全pjセッションで自動ロードされる共有フロー正本ができ、フロー変更の単一反映点が確立する。
  - goalへの影響: 要件(2)の中核。これが無いと各pjがフローを知らないため、最優先。
  - 検証観点: Claude Code が `~/.claude/CLAUDE.md` を自動ロードする前提が正しいか（→未確定3参照）。

- [ ] **A2. `~/.codex/rules/default.rules` を汎用のみに剪定**
  - 操作対象: `~/.codex/rules/default.rules`
  - 操作内容: 真に汎用な prefix_rule（`git add` / `git switch -c` / `git commit` / `codex exec` / `pnpm install`）のみ残し、P1固有の約37件（PORT/HOST/lsof/特定PIDの kill/inline playwright/絶対パス store-dir/`pnpm orchestrate`/`pnpm verify:r3f`/`pnpm -F server dev` 等）を除去。durable な P1運用コマンドは B3 で project-local へ移管、ephemeral（特定PIDの kill 等）は破棄。
  - 影響場所と効果: P2/P3 で codex 実行時に P1固有 allow の誤適用が消え、責務が汎用global＋pj固有に分離。
  - goalへの影響: 要件(3)を満たす。B3 と対で完結。

- [ ] **A3. `~/.codex/config.toml` に todo(goal-navigator) の trust_level を追加**
  - 操作対象: `~/.codex/config.toml`
  - 操作内容: `[projects."/Users/ooizumiyou/todo"]` に `trust_level = "trusted"` を追記。`approval_policy=never` / `sandbox_mode=workspace-write` / `model=gpt-5.5` 等の汎用設定はそのまま。
  - 影響場所と効果: P3 で `goal:exec` の codex exec が認証無しで動く。
  - goalへの影響: 要件(4)の P3 を `goal:*` フローに乗せる前提配線。

### グループB — P1 web_mental-model-space（旧フロー完全削除 + 配線）

- [ ] **B1. CLAUDE.md を書き換え（削除の前提配線）**
  - 操作対象: `/Users/ooizumiyou/web_mental-model-space/CLAUDE.md`
  - 操作内容: 行101 の「自動開発フロー(v3, 役割反転)」節を削除。行140-152「必須参照」節から旧フロー資産（AGENTS.md / automation-review-loop-design.md / orchestrator/tasks/README.md / runbook.md / design-pipeline.mjs）への参照を除去し、必読を `docs/goal.md` / `docs/plan.md` / `docs/orchestrator/designs/2d-mouse-ai-local-workspace.md` / `docs/orchestrator/reference-skills/README.md`（ドメイン参照）に絞る。冒頭に「開発フローは global `~/.claude/CLAUDE.md` と `goal:plan`/`goal:exec` を正本とする」旨と project-governance skill への案内を追記。**末尾に `## Skills config` を新設**（base_branch: develop / phase_registry: docs/plan.md / tasks_file: docs/plan.md（または該当）/ design_dir: docs/orchestrator/designs / commit_msg_hook_requires_tasks: false）。
  - 影響場所と効果: 毎セッション必読の指示から旧フローが消え、phase-* が正しい `docs/plan.md` を参照。B2 の削除が安全になる（参照元を先に断つ）。
  - goalへの影響: 要件(1)(2)(6)。g4・g6 を解消。

- [ ] **B2. 旧フロー資産を削除**
  - 操作対象: `scripts/orchestrate-scope.mjs`、`.claude/workflows/design-pipeline.mjs`、`.claude/skills/{project-orchestrator,project-review,worker-fix,worker-implement}`、`AGENTS.md`、`docs/automation-review-loop-design.md`、`docs/orchestrator/{runbook.md, tasks/README.md, tasks/*.md, pr-drafts/*}`（＝フロー部分のみ）
  - 操作内容: 上記を git rm。**残す（project固有/ドメイン）**: `.claude/skills/project-governance/**`、`scripts/verify-*.mjs`、`docs/goal.md`、`docs/plan.md`、`docs/orchestrator/designs/**`、`docs/orchestrator/reference-skills/**`、`packages/**`。
  - 影響場所と効果: 旧 v3 ハーネスと閉じた参照グラフが消え、二重管理が解消。
  - goalへの影響: 要件(1) の中核。g5 を解消。
  - 注意: B1 完了後に実行（参照を先に断つ）。`docs/orchestrator/` 配下の domain と flow が混在 → ディレクトリ改名は未確定2へ。

- [ ] **B3. P1固有 codex rules を project-local へ移管 / ephemeral を破棄**
  - 操作対象: `/Users/ooizumiyou/web_mental-model-space/.codex/rules/`（新規, project-local）または `AGENTS` 相当
  - 操作内容: A2 で global から外した P1固有ルールのうち durable なもの（`pnpm -F server dev` / `pnpm -F ui-web dev` / 使用ポート / `pnpm verify:r3f` / verify 用 playwright 起動）を project-local codex rules に転記。特定PIDの `kill`・一回限りの inline playwright は破棄（必要時に再生成）。
  - 影響場所と効果: P1 の codex 実行時のみ P1固有 allow が効く。
  - goalへの影響: 要件(3)(6)。A2 と対で g2/g7 を解消。
  - 注意: project-local codex 設定の正しい配置（`.codex/rules/` で読まれるか）は未確定4へ。

- [ ] **B4. `docs/plans/` を新設**
  - 操作対象: `/Users/ooizumiyou/web_mental-model-space/docs/plans/`（新規, `.gitkeep`）
  - 操作内容: ディレクトリ作成。以後 P1 での `goal:plan` 出力先を統一。
  - 影響場所と効果: P1 でも `goal:plan` がプロジェクト内に計画を吐ける。
  - goalへの影響: g8 を解消。出力パス挙動は未確定1で確定後に調整。

### グループC — P2 nestify（最小配線 + クリーンアップ）

- [ ] **C1. CLAUDE.md に `goal:plan`/`goal:exec` ポインタを追加**
  - 操作対象: `/Users/ooizumiyou/nestify/.claude/CLAUDE.md`
  - 操作内容: 既存 `## Skills config`（develop に実装済）はそのまま。本体に「実装フローは global `goal:plan`/`goal:exec` を正本とする」旨の短い案内を追加。check/dev-restart/review-diff の local 維持は変更しない。
  - 影響場所と効果: nestify が共有フロー正本（A1）を明示参照。残る唯一の未配線が埋まる。
  - goalへの影響: g9 を解消。nestify は他作業ほぼ不要。

- [ ] **C2. stale ブランチを削除**
  - 操作対象: ローカル/リモートブランチ `chore/globalize-phase-skills`, `chore/claude-config-refactor`
  - 操作内容: develop に対し 0 unique commit（マージ済）であることを再確認の上、`git branch -d` / `git push origin --delete`。
  - 影響場所と効果: 役割を終えた config リファクタ用ブランチが消え、ブランチ一覧が現状を正しく反映。
  - goalへの影響: g10 を解消（保守性向上）。
  - 注意: 削除は破壊的・外向き操作のため、実行時にユーザ確認を取る（未確定5）。

### グループD — P3 todo / goal-navigator（global flow への新規接続）

- [ ] **D1. CLAUDE.md に `## Skills config` + `goal:*` ポインタを追加**
  - 操作対象: `/Users/ooizumiyou/todo/CLAUDE.md`
  - 操作内容: `## Skills config` YAML（base_branch: develop / branch_pattern / phase_registry: <D2で確定> / tasks_file: <D2> / commit_msg_hook_requires_tasks: **false**（Go・フック無し）/ design_dir）を追加。本体に global `goal:*` を正本とする案内を追加。go-* agents は残置。
  - 影響場所と効果: todo が初めて global phase-* / goal:* に接続。
  - goalへの影響: 要件(4)(6)。g11 を解消。

- [ ] **D2. phase_registry/tasks_file の実体確定 + `docs/plans/` 新設**
  - 操作対象: `/Users/ooizumiyou/todo/` 配下（`docs/plans/`, phase_registry 用ファイル）
  - 操作内容: 既存 root `plan.md`（Phase7実装計画）を phase_registry に格上げするか、`docs/` 構成を新設するかを確定し、`docs/plans/` を作成。D1 の YAML 値と整合させる。
  - 影響場所と効果: phase-* / goal:plan が todo で正しいファイルを参照・出力。
  - goalへの影響: g12 を解消。
  - 注意: todo の docs 構成は他2pjと異なる → レイアウトは未確定1で方針統一。

---

## 未確定・要判断事項

1. **`goal:plan` 出力先パスの解決挙動と docs レイアウト統一**
   `goal:plan` の出力 `docs/plans/$ARGUMENTS.md` は CWD 相対。3pj とも `docs/plans/` が無く、todo は root に `plan.md` を置く異なる構成。
   - (a) 各pjに `docs/plans/` を新設し統一（B4/D2 で実施）
   - (b) pjごとの既存構成を尊重し出力先のみ個別調整
   - (c) global側で出力先を設定可能にする（コマンド改修＝スコープ拡大）

2. **P1 `docs/orchestrator/` の改名要否**
   flow部分（tasks/runbook/pr-drafts）削除後、`designs/` と `reference-skills/`（ドメイン）が残る。「orchestrator」名はフローを連想させる。
   - (a) `docs/designs/` 等へ改名し CLAUDE.md 参照も更新
   - (b) 改名せず現状ディレクトリ名を維持（参照の張替えコスト回避）

3. **global `~/.claude/CLAUDE.md` の自動ロード前提**
   Claude Code が global の `~/.claude/CLAUDE.md` を毎セッション自動ロードする保証を未確認（project CLAUDE.md は確実にロードされる）。
   - (a) 自動ロードされる前提で A1 を正本化
   - (b) 自動ロードされないなら、各pj CLAUDE.md から global 契約への短い参照（必読指示）を必ず張る配線を追加

4. **P1固有 codex rules の移管先**
   project-local codex 設定の正しい配置（`<pj>/.codex/rules/` が codex に読まれるか、`AGENTS.md` 経由か）を未検証。
   - (a) `<pj>/.codex/rules/` に置けるか実機確認の上で移管
   - (b) durable rules も含め破棄し、必要時に再生成（移管しない＝最小工数）

5. **実行の外向き・破壊操作の扱い（PR/ブランチ削除）**
   要件(5)で全ターゲット PR まで進めるが、global は base=**main**（P1/P2/P3 は develop）。
   - (a) global は main向けPR、3pj は develop向けPR で進め、C2 のブランチ削除は実行時にユーザ確認
   - (b) global 変更は PR を介さずブランチコミットのみ（main 直 PR を避けたい場合）

6. **空 global skill `pj-new`/`pj-open`/`pj-close` の扱い（スコープ拡大の是非）**
   今回 goal で確立する「新pj = `## Skills config` 追加 + codex trust 追加 + `docs/plans/` 新設」を自動化する `pj-new` skill を実装すると、4本目以降のpj追加が定型化する。
   - (a) 今回はスコープ外（3pj手動配線のみ）。空dirは放置 or 削除
   - (b) `pj-new` を本計画に追加し、オンボーディングを institutionalize

---

**次のアクション**: 本 plan.md を確認・編集のうえ `/goal:exec /Users/ooizumiyou/.claude/docs/plans/globalize-dev-flow.md` を実行してください（特に「未確定・要判断事項」の1〜6を先に確定すると実行が滑らかです）。
