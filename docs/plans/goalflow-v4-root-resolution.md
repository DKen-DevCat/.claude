# Goal: goalflow v4 を「veto を尊重した再設計」で根本解決する（exec 制御の置き場所・verify構造解・critic根治・コスト計測・dogfood・環境恒久化）

直前の continuation plan（achievable-half）が gate 付き次サイクルへ送った全範囲を、**veto を尊重した再設計**として根本から解決する。中核は「exec 制御ロジック（Tier勾配/worktree並列/branch-mergeバリア/loop-until-done）を、veto された exec.md ではなく **新規 controller（command md）＋/loop** に据え直す」こと。併せて verify の構造解（baseline）・investigate critic の過剰発火/高コストの根治・コスト計測の一次ソース化・dormant 解消後の dogfood・環境（plan.md fragility＋settings security）の恒久化までを、依存順の PR 群として設計する。

> **ロック済み決定（ユーザ確定・2026-06-09）**
> 1. **veto 方向** = veto 尊重で再設計（`commands/goal/exec.md`(v3) は不変）。
> 2. **veto 射程** = 狭義（exec.md ファイルのみ）→ **新規 補助 command md（候補B）は許容** → **2トラック設計**。
> 3. **permission/security ポリシー（決定的）**:
>    - **worktree 操作 = 全許可**（add/remove 含む）。
>    - **git 履歴改変（`reset --hard` / `branch -D` / force push / rebase / `commit --amend`）= 一律禁止**。
>    - **merge = 許可**。ただし Claude が**自律マージするのは「並列作業の集約時」と「明示的に『PR xx をマージして』と言われた時」のみ**。
>    - **作業完了 → main への統合は必ず PR 経由**。
> 4. （派生）**rollback 設計は `reset --hard` 不使用** = 失敗 worktree は `git worktree remove` で破棄（＋必要なら `git revert`＝履歴を改変しない）。
> 5. （派生）**settings.json は履歴改変 deny を復元**し、`allow` を `Bash(*)` から build/test＋git安全系の明示列挙へ絞る（backstop 回復＋riskgate 両立）。

## 背景（なぜ / 要件 / 前提）

**なぜ**: v4 は code+prose で実装されたが (a) 実走未証明、(b) exec 側の正本化手段（exec.md 大改変＝PR#12）が**ユーザの記録済み veto**（`feedback_goal_exec_loop.md:14`）に正面衝突、(c) verify は誤検知の band-aid（候補A）止まりで構造解（baseline）未達、(d) investigate critic が過剰発火し実 goal で収束せず毎回 1.2〜1.8M tokens、(e) コスト計測機構が不在、という root を抱える。continuation plan はこのうち achievable な半分だけを切り取った。本 plan はその残り全部を **veto を尊重した再設計**で根本解決する。

**要件**:
1. **置き場所**: exec 制御（Tier/並列/branch-merge/loop）を exec.md(v3) を触らず、新規 controller command md（候補B）＋`/loop`（候補A）に据える。permission ポリシー（worktree全許可・履歴改変禁止・merge は集約/明示時のみ自律・統合は PR 経由）を controller に内蔵。
2. **verify 構造解**: verifier が `baseCommit..HEAD`（task 開始前 HEAD SHA からの真の task 差分）のみを根拠にし、自走 git/独自 baseline/`--name-only` 走査を封じる（候補C＝workflow.js の baseCommit 引数＋prompt lockdown＋controller の per-task commit-before-verify）。後方互換・read-only 維持。
3. **critic 根治**: 収束到達とコスト削減を両立。AND（全レンズ high ゼロ）は維持（偽収束防止）し、差分注入＋意味的 dedup＋settled gap carry で過剰発火/二乗膨張を断つ。
4. **コスト計測**: workflow journal `totalTokens`＋session jsonl `usage`＋codex `--json` を一次ソースに、loop 完了後 or controller で集計（新規ファイル不要）。codex コスト捕捉は controller が codex を呼ぶことで成立。
5. **dogfood**: dormant-until-evidence を再設計で解消した上で、低リスクな自然 Tier B/C goal を実走し、並列/Tier/branch-mergeバリア/loop と実コストを観測（合格 artefact を定義）。
6. **環境恒久化**: docs/plans を git 追跡化（fragility 解消）＋.goalflow//.codex-out/ を ignore＋settings.json の履歴改変 deny 復元・allow 明示列挙化。これは v4 実走の**事前順序制約**。

**前提（2本の investigation で grounded）**:
- verifier は実機で git 自走（agentType=`workflow-subagent`）し、baseline 無しでは独自 baseline を即興選択し `--name-only` で target 外を走査する＝誤検知の機構。
- `/loop` は組込（バイナリ内・on-disk 定義なし）。`autonomous-loop-dynamic` sentinel＋完了通知 primary wake＋ScheduleWakeup fallback heartbeat（clamp[60,3600]）で**直列 loop-until-done を exec.md 不変でホストできる**（feedback L12/L18 の処方）。但し**並列待ち primitive を持たない**＝並列は controller（候補B）必須。
- skill md は frontmatter で allowed-tools を宣言できない（既存7 skill 実機確認）→ 破壊的でない worktree/merge/build-test 工具を載せられるのは **command md のみ**。
- PR#11（plan側）/PR#12（exec側）はファイル重複ゼロ・両 OPEN/MERGEABLE/CLEAN。**v4 normative prose は PR#12 の CLAUDE.md のみ**にあり veto された exec.md と束ねられている＝PR#12 をマージせず v4 規範を main に入れる経路が現状ない。
- `docs/plans` は `.gitignore` の `plans/` で git 未追跡（本 plan.md 自身も含む）。settings.json は 6/3 起源（Claude の変更でない・reflog 痕跡なし）で deny から履歴改変2件が削除済み＋allow `Bash(*)`＋acceptEdits。

## 調査結果（goal実態 / 現状実態 / ギャップ）

- **goal実態**: 根本解決は6本柱（置き場所/verify/critic/コスト/dogfood/環境）で、**依存連鎖**を持つ。環境恒久化（PR-0）が他全ての事前順序制約。controller（PR-3）が verify baseline の注入元かつコスト集計の母体。
- **現状実態**: exec 制御は exec.md(v3) に直列のみ。並列/Tier/loop は PR#12（veto された exec.md 改変）にしか無い。critic は AND＋文字列 dedup＋findings 全文再注入で過剰発火（実データ: 12 high で収束せず 1.27M / 17 high で 1.79M）。コスト計測コードは workflows にゼロ。docs/plans・settings は fragile/drift。
- **ギャップ（gold標準との差）**:
  - G1（置き場所）: 2トラック未実装。候補A=/loop（直列・grounded）＋候補B=新 controller command md（並列/バリア/baseline/commit-before-verify/コスト集計）。候補C=tier-policy.md（Tier データのみ・ハイブリッド）。**並列発火機構（背景 Task＋EnterWorktree 等）は read-only 未実証＝dogfood で要確認**。
  - G2（verify）: baseCommit 未注入＋自走 git 未封じ。候補C で構造解。直列でも commit-before-verify を controller が持てば成立。
  - G3（critic）: rubric 厳格化（PR#11 既実装）は効かなかった実証あり。根治は差分注入（コスト core）＋意味的 dedup＋carry（収束・AND 維持）。
  - G4（コスト）: 計測は新設不要（3ソース既存）。codex コスト捕捉は controller が codex caller になる必要。
  - G5（dogfood）: dormant は再設計で解消可（dormant ロジックも controller へ移る＝exec.md 領域でない）。但し初回 Tier B/C にはテスト被覆 repo が要る（~/.claude は不可）。
  - G6（環境）: .gitignore 1行＋settings 整理で恒久解。**v4 実走の事前必須**。

## 実行計画

### PR-0（事前必須・環境恒久化）

- [ ] task-1: docs/plans を git 追跡化＋.goalflow//.codex-out/ を ignore
  - 操作対象: `.gitignore`
  - 操作内容: `plans/` を `/plans/`（先頭アンカー＝~/.claude 直下の自動生成 plans/ のみ除外）に変更、または `!docs/plans/` で docs/plans を再包含。併せて `.goalflow/`・`.codex-out/` を ignore に追加（ledger/codex 出力の untracked dirty が verify diff スコープと PR クリーン性を壊すのを防ぐ）。~/.claude/plans/（自動生成置場）の中身が真に自動生成かを確認後に適用。
  - 影響場所と効果: 唯一の真実 plan.md が git 保護下に入り、worktree 運用や別 session の操作で消失する経路を塞ぐ。
  - goalへの影響: 要件6。他全 PR の**事前順序制約**（破壊的でない worktree 運用でも plan 保全が前提）。
  - 種別: codex 実装（/goal:exec）or 軽微につき人間直接

- [ ] task-2: settings.json を新ポリシーに整える（履歴改変 deny 復元・allow 明示列挙化・追跡化）
  - 操作対象: `settings.json`
  - 操作内容: deny に `Bash(git reset --hard *)`・`Bash(git branch -D *)`（＋force push 系）を**復元**。worktree/merge は許可のまま。`allow` の `Bash(*)` を build/test（`Bash(npm:*)`・`Bash(turbo:*)`）＋git安全系（diff/status/add/commit/merge/worktree/rev-parse/log/show）＋既存 MCP/Web の明示列挙に絞り、permission backstop を回復しつつ riskgate の build/test を維持。独立コミットで追跡化。
  - 影響場所と効果: 破壊的 git の backstop 回復＝controller の自走範囲を permission 層でも縛る。drift 解消。
  - goalへの影響: 要件6＋ポリシー3の permission 層実装。**allow `Bash(*)` 化・additionalDirectories 追加の起源（6/3・Claude でない）は人間 hard-stop で意図確認後に確定**。
  - 種別: codex 実装 or 人間直接（起源確認 gate 後）

### PR-1（critic 根治＝dme/goal 改善の中核）

- [ ] task-3: investigate critic を差分注入＋意味的 dedup＋settled gap carry に
  - 操作対象: `workflows/goal-plan-investigate.workflow.js`（followup 注入 L255/L326、累積 findings L341、dedup L223/232、aggregateCritic/consensus loop）
  - 操作内容: (i)【コスト core】followup probe と critic に渡す context を「findings 全文再注入」から「未解決 high gap に関係する findings 差分のみ」へ（累積による二乗膨張を断つ）。(ii)【収束】文字列 uniq dedup を angle の意味的 dedup（正規化・類似統合）へ。(iii) round 間で settled gap を明示 carry し再生成を抑制。**consensusComplete の AND（全レンズ high ゼロ）は維持**（`fix-investigate-consensus-convergence.md:53`「AND が安全＝偽収束防止」を尊重・AND 緩和は退行として採らない）。返却 schema 後方互換。
  - 影響場所と効果: 12 raw high → 真の独立 ~7-8 に圧縮し収束を到達可能化、1.2〜1.8M tokens を大幅削減。
  - goalへの影響: 要件3。investigate（goal:plan）の実用性とコストを根治。dme/goal 改善の中核。
  - 種別: codex 実装（Tier A 相当・収束挙動はテストで捕まりにくい→フル検証）

### PR-2（verify 構造解）

- [ ] task-4: goal-exec-verify に baseCommit 引数＋prompt lockdown（候補C の workflow 側）
  - 操作対象: `workflows/goal-exec-verify.workflow.js`（args L9-20、side-effects focus L31-35、agent prompt L73-79、diffText フォールバック L18）
  - 操作内容: (i) args に `baseCommit` を追加（undefined フォールバック＝従来動作・PR#11/#12 非衝突）。side-effects 評価を `baseCommit..HEAD` にスコープ。(ii) verifier prompt に「`git diff/status/log/show/--name-only` の自前実行・独自 baseline 選択を禁止、渡された diffText（または baseCommit..HEAD）のみ根拠、pre-existing/未コミット差分は副作用でない」を追記（候補A の lockdown を統合）。
  - 影響場所と効果: L1（自走 git）＋L2（baseline 欠如）を両方塞ぐ。verdict schema・read-only・exec.md 不変。
  - goalへの影響: 要件2。継続 plan の候補A単独（H8 残差あり）を候補C に格上げ＝直列 target 自身 pre-existing も baseCommit で塞ぐ。
  - 種別: codex 実装

### PR-3（exec-v4 controller＝2トラック中核・本 plan の大物）

- [ ] task-5: 新 controller command md を作成（Tier/独立バッチ/worktree並列/branch-mergeバリア/ledger/commit-before-verify/baseCommit注入/コスト集計）
  - 操作対象: 新規 `commands/goal/exec-v4.md`（command md・frontmatter allowed-tools を自前宣言）
  - 操作内容: frontmatter に worktree/merge/rev-parse/log/show/add/commit/npm/turbo/node/Workflow を宣言（**履歴改変系は宣言しない**）。本文に — Tier 判定（**dormant-until-evidence を撤廃し、初回でも target 互いに素∧テスト被覆ありの低リスク独立バッチを Tier B/C 自然判定**）／独立バッチ判定／**per-task commit-before-verify 規律**（feedback L18）＋codex 実行前 `git rev-parse HEAD` で baseCommit を取得し verify Workflow args に注入／worktree+branch 並列 codex／**branch-merge バリア（merge は集約時のみ自律・履歴改変なし・失敗 worktree は remove で破棄＋revert）**／ledger（.goalflow/state/<run-id>.json）／コスト集計（journal totalTokens＋codex --json＋session usage）／**統合は PR 経由・main 直マージしない**。exec.md(v3) は単一タスク実行器のまま不変。
  - 影響場所と効果: veto を尊重しつつ v4 中核（並列/Tier/バリア/baseline/コスト）を獲得。
  - goalへの影響: 要件1/2/4。**並列発火機構（背景 Task＋EnterWorktree 等の実機挙動）は read-only 未実証＝dogfood(task-9)で要確認**と本文に明記。
  - 種別: codex 実装（Tier A・新規 command md・設計密度高）

- [ ] task-6: /loop 起動手順（候補A・直列トラック）を controller/CLAUDE.md に規定
  - 操作対象: `commands/goal/exec-v4.md`（or 別 runbook 節）＋ task-7 の CLAUDE.md
  - 操作内容: `/loop`（interval 省略＝dynamic）で `/goal:exec-v4` を fire し、残タスク列/(a)→(b)→(c)/全完了で PR 提案して停止、をホストする起動手順を規定。完了通知 primary wake／ScheduleWakeup fallback の役割、終了保証（keepalive）を明記。並列バッチは候補B（task-5）が担い、/loop は直列ドライブと全体ループを担う 2トラックの結線を定義。
  - 影響場所と効果: feedback L12/L18 の処方を exec.md 不変で正本化。
  - goalへの影響: 要件1（候補A トラック）。
  - 種別: codex 実装 or Opus 作文

### PR-4（正本 CLAUDE.md の v4 規範・新規書き起こし）

- [ ] task-7: CLAUDE.md に v4 規範を新規書き起こし（PR#12 から切り離す）
  - 操作対象: `CLAUDE.md`（正本・tracked）
  - 操作内容: 役割反転フローを v4 に更新 — 2トラック（/loop 直列＋controller 並列）、permission ポリシー（worktree全許可・履歴改変禁止・merge は集約/明示時のみ自律・統合は PR 経由）、per-task commit-before-verify、Tier 勾配（dormant 撤廃版）、コスト計測。**PR#12 の CLAUDE.md 内容に依存せず新アーキで書く**。
  - 影響場所と効果: main 上の v3 直列規範を v4 に更新し、置き場所成果物と整合させる。CLAUDE.md は tracked＝fragile でない正本。
  - goalへの影響: 全 PJ 共通正本として v4 をグローバル発効させる前提。PR#12 の CLAUDE.md と同一ファイル＝**PR#12 は close 前提**（⚖️）。
  - 種別: codex 実装 or Opus 作文

### Scope-5（マージ段取り＋dogfood 実走証明）

- [ ] task-8: PR#11 マージ＋PR#12 close
  - 操作対象: GitHub PR#11 / PR#12
  - 操作内容: PR#11（plan側・veto非該当・MERGEABLE/CLEAN）を node --check＋最小 goal dry-run 後に単独マージ。PR#12（veto された exec.md＋旧 CLAUDE.md）は本 plan が置き換えるため **close**。いずれも外向き操作＝**人間確認後**（自律マージは「並列集約」「明示指示」のみ＝ここは明示確認が必要）。
  - 影響場所と効果: plan側 v4（critic 含む）が main 発効。重複・矛盾する旧 exec 改変を退役。
  - goalへの影響: 要件全体の main 反映。
  - 種別: 人間 gate（外向き）

- [ ] task-9: dogfood 実走証明（低リスク自然 Tier B/C goal）
  - 操作対象: 選定 repo（⚖️: nestify-ide 推奨＝build/test あり・履歴改変禁止で blast radius bounded／~/.claude は Tier 勾配薄）で実 goal を1サイクル
  - 操作内容: dormant 撤廃版 controller で、target 互いに素∧テスト被覆ありの独立バッチが自然成立する低リスク goal を実走。合格 artefact = (1) `.goalflow/state/<run-id>.json` の created→…→cleaned 遷移、(2) `git worktree list` の生成→消滅、(3) `git log --merges` の集約 merge 痕跡、(4) journal totalTokens＋codex --json のコスト実測。investigate 早期収束（PR-1 後）と residual escalate も別 test goal で観測。
  - 影響場所と効果: 並列/Tier/バリア/loop/コストと critic 根治を実地証明。並列発火機構の実機挙動を確定。
  - goalへの影響: 要件5。v4 を初めて実証明。
  - 種別: Opus/人間が実走・観測

## 未確定・要判断事項

確定済み: veto尊重再設計／veto射程=狭義（2トラック）／permission ポリシー（worktree全許可・履歴改変禁止・merge は集約/明示時のみ自律・統合 PR 経由）／settings 履歴改変 deny 復元／verify=候補C／critic=AND維持+差分注入+dedup+carry／補助md=command md。残る ⚖️:

- ⚖️ **dogfood repo（task-9）**: nestify-ide（並列を実証明できる唯一・blast radius は履歴改変禁止で bounded）か ~/.claude（安全だが Tier 勾配薄＝並列未証明）か。あなたのプロダクト repo を dogfood に供する是非。**推奨=nestify-ide**。
- ⚖️ **PR#12 の処分（task-8/task-7）**: PR#12 を close（exec.md veto＝破棄・CLAUDE.md は本plan で新規書き）でよいか。close は外向き＝exec 時に確認。**推奨=close**。
- ⚖️ **今サイクルの段階リリース射程**: 6 PR を一気通貫で回すか、即効性の高い **PR-0（環境）→PR-1（critic 根治＝investigate コスト即削減）→PR-2（verify）** を先行し、大物の **PR-3（controller）→PR-4→Scope-5** を後続サイクルに分けるか。**推奨=2段階**（PR-0/1/2 先行で土台と即効を取り、controller は dogfood とセットで後続）。
- ⚖️ **settings.json の非・履歴改変部分の起源**: 履歴改変 deny 復元はポリシーで確定。但し allow `Bash(*)` 化・additionalDirectories 追加（6/3・Claude でない・reflog 痕跡なし）の意図は追跡不能＝**人間 hard-stop**で確認後に明示列挙を確定。
- ⚖️ **要確認（dogfood でのみ解ける）**: controller の**並列発火機構**（背景 Task＋EnterWorktree／worktree+codex top-level 並列の待ち合わせ）の実機挙動は read-only 未確定。task-5 設計に「並列は dogfood で実証する要確認事項」と明記済み。実証できなければ並列は tick 内 orchestration へ縮退 or 次サイクル。
- ⚖️ **continuation plan との関係**: 本 root plan は continuation を**包含**する（continuation の verify候補A ⊂ 本 task-4 候補C／continuation の settings 追跡化 → 本 task-2 で deny 復元へ方針転換／continuation の plan側証明 → 本 task-9 dogfood＋PR-1 critic 修正）。**continuation plan の exec（task-1 で保留中）は本 root plan に吸収して廃止**するのが整合的（要確認）。

## PR仕様（PR / スコープごと。/goal:exec はこの仕様どおりに PR 本文を書く）

- **PR-0**: `~/.claude` — 環境恒久化（fragility＋settings security）
  - 目的: docs/plans を git 追跡化し、settings.json を新 permission ポリシーに整える（v4 実走の事前必須土台）。
  - 満たすべき要件: .gitignore で docs/plans 追跡化・.goalflow//.codex-out/ ignore／settings は履歴改変 deny 復元・allow 明示列挙化・追跡化／settings 非・履歴改変部分の起源は人間確認後。
  - 着手前 / 完了後: plan.md が git 保護外・破壊的 git の backstop 喪失 → plan 追跡下・履歴改変 permission 禁止。
  - 作業フロー図（mermaid）:
    ```mermaid
    flowchart TD
      A[task-1: .gitignore /plans/ アンカー+.goalflow/.codex-out ignore] --> C[git status で docs/plans が追跡対象化を確認]
      B[起源確認 hard-stop: allow Bash*/additionalDirs の 6/3 起源] --> D[task-2: deny 復元+allow 明示列挙+追跡化]
      D --> E[JSON妥当性+権限が新ポリシーと一致を確認]
      C --> F[完了: v4 実走の土台]
      E --> F
    ```
  - 解決タスクと goalへの効果: task-1/2 → 要件6＋ポリシー3 の permission 実装。
  - PR外への影響: permission 変更は ~/.claude 全 session に影響（履歴改変が確認必須化＝安全側）。
  - Verification: `node -e "JSON.parse(require('fs').readFileSync('settings.json','utf8'))"`＋`git check-ignore docs/plans/x.md`（追跡対象化確認）＋`git status`。
  - その他共有事項: settings 起源確認は hard-stop。

- **PR-1**: `~/.claude` — investigate critic 根治（差分注入＋意味dedup＋carry）
  - 目的: critic の過剰発火/二乗膨張を断ち、収束到達とコスト削減を両立（AND 維持）。
  - 満たすべき要件: 返却 schema 後方互換／read-only/loop 終了保証維持／AND 緩和は採らない／rubric 厳格化は補助。
  - 着手前 / 完了後: 実 goal で収束せず 1.2〜1.8M tokens → 差分注入で大幅減・意味dedup+carry で収束到達。
  - 作業フロー図（mermaid）:
    ```mermaid
    flowchart TD
      A[task-3: followup/critic context を findings差分のみ注入] --> D[node --check]
      B[task-3: 文字列uniq→意味的dedup] --> D
      C[task-3: round間 settled gap carry / AND維持] --> D
      D --> E[小goalで収束到達+token大幅減を観測]
    ```
  - 解決タスクと goalへの効果: task-3 → 要件3。investigate/goal:plan の実用性・コスト根治。
  - PR外への影響: PR#11（同 workflow）に積む or PR#11 マージ後の別 PR。plan.md 呼び出し側は schema 後方互換で無変更。
  - Verification: `node --check workflows/goal-plan-investigate.workflow.js`＋小 goal dry-run で round/token 観測（before/after 比較）。
  - その他共有事項: PR#11 の rubric 修正は「必要だが収束不十分」と実証済＝本 PR が収束の根治。

- **PR-2**: `~/.claude` — verify 構造解（候補C: baseCommit＋lockdown）
  - 目的: verifier を baseCommit..HEAD のみ根拠にし自走 git/独自 baseline を封じる。
  - 満たすべき要件: baseCommit は undefined フォールバック（PR#11/#12 非衝突）／verdict schema 後方互換／read-only／exec.md 不変。
  - 着手前 / 完了後: verifier が自走 git で pre-existing を HIGH 誤検知 → baseCommit..HEAD＋lockdown で構造的に抑止。
  - 作業フロー図（mermaid）:
    ```mermaid
    flowchart TD
      A[task-4: args に baseCommit 追加 undefined フォールバック] --> C[node --check]
      B[task-4: verifier prompt lockdown 自走git/独自baseline禁止] --> C
      C --> D[pre-existing差分が在る状態の最小verifyで HIGH=0 を複数回確認]
    ```
  - 解決タスクと goalへの効果: task-4 → 要件2。継続 plan の候補A を候補C に格上げ（H8 残差解消）。
  - PR外への影響: baseCommit が効くのは controller（PR-3）が注入してから。それまでは undefined フォールバック＝従来動作。
  - Verification: `node --check workflows/goal-exec-verify.workflow.js`＋pre-existing 差分下の最小 verify dry-run（複数回・HIGH=0 安定）。
  - その他共有事項: 直列でも commit-before-verify（PR-3）と組んで初めて構造解が完成。

- **PR-3**: `~/.claude` — exec-v4 controller（新 command md・2トラック中核）
  - 目的: exec 制御（Tier/並列/branch-mergeバリア/loop/baseline/コスト）を exec.md 不変で controller command md＋/loop に据える。
  - 満たすべき要件: exec.md(v3) 不変／permission ポリシー内蔵（worktree全許可・履歴改変禁止・merge は集約/明示時のみ自律・統合 PR 経由）／per-task commit-before-verify／dormant 撤廃で初回 Tier B/C 可／コスト集計。
  - 着手前 / 完了後: 並列/Tier/loop が PR#12（veto）にしか無い → veto 尊重の controller で獲得。
  - 作業フロー図（mermaid）:
    ```mermaid
    flowchart TD
      A[task-5: 新 commands/goal/exec-v4.md frontmatter 工具宣言 履歴改変除く] --> B[Tier判定 dormant撤廃 / 独立バッチ判定]
      B --> C[task-5: per-task commit-before-verify + rev-parse baseCommit 注入]
      C --> D[worktree+branch 並列codex / branch-mergeバリア 集約時自律merge 失敗はworktree破棄+revert]
      D --> E[ledger .goalflow + コスト集計 journal/codex --json/session]
      F[task-6: /loop で exec-v4 を fire 直列loop-until-done 2トラック結線] --> E
      E --> G[node --check / 並列発火は task-9 dogfoodで実証]
    ```
  - 解決タスクと goalへの効果: task-5/6 → 要件1/2/4。
  - PR外への影響: exec.md(v3) 不変。CLAUDE.md 規範更新（PR-4）と整合必須。
  - Verification: `node --check`（md に JS があれば）＋frontmatter lint＋並列発火は task-9 dogfood で実証（read-only 未確定の要確認事項）。共通 build/test 無し repo のため一部は手レビュー。
  - その他共有事項: 並列発火機構（背景 Task＋EnterWorktree 等）は dogfood でのみ確定。実証不可なら tick 内 orchestration 縮退 or 次サイクル。

- **PR-4**: `~/.claude` — CLAUDE.md v4 規範（新規書き起こし）
  - 目的: 正本 CLAUDE.md を v4（2トラック・permission ポリシー・commit-before-verify・Tier・コスト）に更新し PR#12 から切り離す。
  - 満たすべき要件: PR#12 の CLAUDE.md に依存せず新アーキで書く／フロー本体の正本性を保つ。
  - 着手前 / 完了後: v4 規範が PR#12（veto exec.md と束ね）にしか無い → 本 plan PR で独立に正本化。
  - 作業フロー図（mermaid）:
    ```mermaid
    flowchart TD
      A[task-7: CLAUDE.md 役割反転フローv4 を新規書き起こし] --> B[2トラック/permissionポリシー/commit-before-verify/Tier/コスト]
      B --> C[PR#12 は close 前提 ⚖️]
    ```
  - 解決タスクと goalへの効果: task-7 → v4 のグローバル正本化。
  - PR外への影響: 全 PJ 共通正本＝全プロジェクトに影響。PR#12 と同一ファイル＝PR#12 close 前提。
  - Verification: なし（手レビュー＝正本 prose）。
  - その他共有事項: PR#12 close は外向き＝人間確認（task-8）。

- **Scope-5**: マージ段取り＋dogfood（task-8 / task-9）
  - 目的: PR#11 を main 発効、PR#12 を退役し、dogfood で v4 を実証明。
  - 満たすべき要件: 外向き操作（マージ/close）は人間確認／dogfood は dormant 迂回せず自然 Tier B/C goal／合格 artefact を観測。
  - 着手前 / 完了後: v4 未実走・PR 未整理 → main 発効＋並列/Tier/loop/コストと critic 根治を実証跡化。
  - 作業フロー図（mermaid）:
    ```mermaid
    flowchart TD
      A[task-8: PR#11 を node --check+dry-run後マージ 人間確認] --> B[task-8: PR#12 を close 人間確認]
      B --> C[task-9: 選定repo で低リスク自然Tier B/C goal を実走]
      C --> D[合格artefact: ledger遷移/worktree生成消滅/--no-ff merge痕跡/totalTokens]
      D --> E[investigate早期収束+residual escalate も別goalで観測]
    ```
  - 解決タスクと goalへの効果: task-8/9 → 要件5＋全体の main 反映。
  - PR外への影響: PR#11 マージは plan側 v4 をグローバル発効。
  - Verification: dogfood の合格 artefact 観測（手レビュー＝ledger/worktree/merge/journal）。
  - その他共有事項: dogfood repo は ⚖️（nestify-ide 推奨）。自律マージは「並列集約」「明示指示」のみ＝PR#11/main 統合は明示確認。

---

## 実行順序（依存）

```
PR-0（環境: .gitignore + settings）  ← 事前必須・他全ての前
   ├─ PR-1（critic 根治）            ← 独立・即効（investigate コスト削減）
   ├─ PR-2（verify baseCommit+lockdown）← 独立
   └─ PR-3（exec-v4 controller）      ← PR-2 の baseCommit を使う
         └─ PR-4（CLAUDE.md v4 規範） ← PR-3 設計確定後
               └─ Scope-5（PR#11 merge / PR#12 close / dogfood）← 全 PR ready 後・外向きは人間確認
```

推奨 = **2段階**: 第1弾 PR-0→PR-1→PR-2（土台＋即効），第2弾 PR-3→PR-4→Scope-5（controller＋dogfood）。
