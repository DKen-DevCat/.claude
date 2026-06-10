# Goal: goalflow 実行レイヤーの Claude Code 一本化（/goal:exec-v5）

## 背景（なぜ / 要件 / 前提）

### なぜ
1. **/loop 自律実行が本当のゴールであり、ハングが致命的。** codex exec は harness が完了通知を保証できない唯一の外部プロセスで、`codex-exec-guard.sh`（perl wall-clock 有界化 hack）を要した。root cause は memory `feedback_codex_ratelimit_hang`（xhigh 巨大トークン予約 × TPM/RPM 枯渇 → 429 → silent backoff）で確定済み。Agent / Workflow は harness 管理で、完了時に orchestrator が必ず再起動される——Claude 一本化で**ハングというクラス自体が消える**。
2. **長期タスクでコンテキストが膨らむと codex が後半で潰れる。** 1タスク = 1 fresh subagent なら毎タスク新鮮なコンテキストで始まる。
3. **最終的に codex を解約する。**

### 要件（intake 確定・2026-06-10）
1. plan は対話のまま不変。承認後 `/loop /goal:exec-v5 <plan>` で以降は完全自律（質問は queue に溜めループ後に一括返却）。
2. 実装は 1タスク = 1 fresh subagent（Agent tool）。並列バッチ（target 互いに素 ∧ 依存なし ∧ Tier B/C）は worktree isolation。**1 attempt = 1 subagent** の不変条件。
3. 実装 subagent は成果サマリを `.codex-out/<task-id>.md` に書き、viz の 3観測 seam を無改修で生かす（seam 改名はスコープ外）。
4. v4 制御は維持: commit-before-verify + baseCommit / Tier 勾配 / branch-merge バリア / loop-until-done（maxAttempts=3・maxRounds=3・no-progress）/ コスト計測。
5. ledger（`.goalflow/state/` 状態機械）を**必須実装**に格上げ（自律 resume の前提）。
6. 検証は `goal-exec-verify.workflow.js` を継続使用。最終判定は orchestrator（Fable 5）。`codexSummary` 引数は**無改修流用**（実装者自己申告サマリとして意味再解釈。undefined 安全・VERDICT 不関与を実測確認済）。
7. モデル: orchestrator は frontmatter に `model:` を書かず**セッション継承**（既定 = settings.json の `claude-fable-5[1m]`、`/model claude-opus-4-8` 明示時は Opus 4.8）。verify / investigate worker は sonnet のまま（現状維持・変更不要）。（2026-06-10 更新: 当初確定の「frontmatter = claude-fable-5[1m]」ピンを継承方式へ変更。ピンは明示 opus 経路を塞ぎ、mid-session モデル切替で prompt cache を全壊するため。/goal:plan の opus-4-8 ピンも同理由で撤去）
8. 終端: 全タスク verified + 統合チェック後、PR仕様に従い **draft PR を自動作成して停止**（従来 hard-stop の明示緩和。ユーザ確定）。main 直接 merge・PR マージ・git 履歴改変は引き続き禁止。
9. hook 撤去は移行期間（v3/v4 が codex を使用）を考慮し、**codex 解約と同期する follow-up**（本 goal では物理削除しない）。
10. グローバル CLAUDE.md と memory の更新を含める。

### 前提（一次確認済の事実）
- **Agent tool は orchestrator の live schema で実在確認済**（plan 作成 session で実測）: `subagent_type` / `model` / `isolation:"worktree"` / `run_in_background` を持つ。`general-purpose` は Tools:*（write-capable）。probe-subagent には不可視（orchestrator レベルツール）のため、in-repo file からは取得不能だった。
- **未実証のまま残るもの**: worktree 隔離下での write の着地・並列発火と待ち合わせの end-to-end（dogfood でのみ確定可能）→ §6 は直列フォールバック posture を維持。
- gh CLI 2.89.0・`gh auth status` = DKen-DevCat / ssh / repo scope（一次確認済）。origin = `git@github.com:DKen-DevCat/.claude.git`。
- `.goalflow/` と `.codex-out/` は .gitignore 済（一次確認済）→ ledger・実装サマリは PR diff に入らない。
- settings.json の居座り未コミット差分（if ガード削除＋`model: claude-fable-5[1m]` 追加＋キー順入替。**deny は無傷**）は「**全部 commit**」でユーザ確定（2026-06-10・AskUserQuestion）。
- exec.md(v3)・exec-v4.md は不変（v3 編集は却下済み）。CLAUDE.md が参照する `docs/plans/goal-exec-codex-large-task-hang.md` は実在しない（dangling・除去対象）。
- memory 2件は gitignore 済 harness memory（PR 外の直接編集。`feedback_codex_ratelimit_hang` は nestify スコープ = `projects/-Users-ooizumiyou-nestify/memory/`）。

## 調査結果（goal実態 / 現状実態 / ギャップ）

### goal 実態
- exec-v4 §1-13 の制御フレーム（唯一の真実 / permission / (a)(b)(c) / commit-before-verify / Tier / worktree 並列 / merge バリア / ledger prose / loop / コスト / PR）は v5 の母体としてそのまま使える。差し替えは「(b) 実装層」「終端」「ledger 実装化」の3点に局所化される。
- ハング消滅の論拠は実態と一致: 唯一の harness 非追跡プロセス（codex exec）を Agent に置換すると、完了通知 = primary wake が保証される。
- 終端手段は read-only で確定済: `gh pr create --draft`（auth 済）と `mcp__github__create_pull_request`（`draft:boolean` スキーマ確認済）の両方が利用可能。

### 現状実態
- 実装機構の二択: (A) orchestrator 直叩き `Agent(subagent_type:'general-purpose')` / (B) 実装 workflow + agent()。**champion = (A)**（ペア比較・実行級）: タスク間に Opus 最終判定ゲートが挟まる以上、workflow で束ねると per-task ゲートが壊れる。(A) は「実装者は Workflow の外・top-level 呼び出し」という既存ドクトリンと同型で、live schema 確認済み。
- ledger 書き手: **orchestrator 単独書込が唯一 race-free**。subagent が isolation:worktree 下で ledger を書くと worktree コピーに落ち cleanup で消失（構造的に不可）。harness の「完了通知ごとに orchestrator 再起動」が天然の単一書込点。
- run-id: in-repo 唯一の既存式（日付+HEAD SHA）は resume を壊すため流用不可。**plan slug ベースの決定論採番**が resume 成立の前提（exec-v4 §1 の「不採番」方針を明示的に覆す）。
- viz 整合: viz は run-id を知らず tasks.json mtime を runWindow とする。resume 時のみ穴があり、`fuse --since=<ledger の run 開始 ISO>`（既存機能・追加実装ゼロ）で解消。
- verify workflow: `codexSummary` は行19 undefined 安全・行97-101 VERDICT 不関与・行89 参考注入のみ → 無改修流用が最小差分で v3/v4 後方互換を壊さない。
- settings.json deny に `rebase` / `commit --amend` が欠落（prose 防御のみ）。CLAUDE.md は既に「deny でも多層に担保」を宣言しており、追記は新ポリシーではなく完全化。
- hook は if ガード削除後も内部で codex exec 以外を fail-open 素通り（codex-exec-guard.sh:20-29 実測）→ 残置しても v5 の Bash 経路に実害なし。即削除すると v3/v4 で codex hang が再発 → deprecate 後削除。

### ギャップ（= 実行計画の根拠）
1. exec-v5.md が存在しない（主成果物）。
2. ledger は prose 定義のみで実装ゼロ（採番・書込・読出・viz 結線の4点が新規設計）。
3. CLAUDE.md / settings.json / memory が codex 前提のまま（正本と多層防御の不整合）。
4. draft PR 終端は CLAUDE.md「PR作成は事前確認」と衝突 → exec-v5 限定例外条項の二層構成で解消。

## 実行計画

- [ ] task-1
  - 操作対象: `settings.json`
  - 操作内容: 居座り未コミット差分（if ガード削除＋`model: claude-fable-5[1m]` 追加＋キー順入替）を**そのまま採用**（ユーザ確定）し、`permissions.deny` に `Bash(git rebase *)` と `Bash(git commit --amend*)` を追記して同一コミットに含める。`node -e "JSON.parse(require('fs').readFileSync('settings.json','utf8'))"` で parse 検証。
  - 影響場所と効果: global model が fable-5[1m] に固定。hook は全 Bash 発火だが fail-open で機能影響なし（ms オーバーヘッドのみ）。履歴改変の deny 防御が CLAUDE.md prose と一致して完全化し、自律 /loop 中の履歴改変が物理拒否される。2026-06-03 から居座る security 要確認差分が解消。
  - goalへの影響: 自律実行の安全基盤（多層防御）が完成し、exec-v5 が無人走行する前提が整う。
- [ ] task-2
  - 操作対象: `commands/goal/exec-v5.md`（新規）
  - 操作内容: exec-v4 §1-13 を母体に、次の仕様で controller を新規作成する。
    - **frontmatter**: `description`（Claude 一本化 v5 controller。/loop 自走・draft PR 終端）/ `argument-hint: docs/plans/<goal-slug>.md` / `model:` 指定なし（セッション継承。2026-06-10 更新——要件7参照）/ `allowed-tools`: Read, Grep, Glob, Write, Edit, Agent, Workflow, TaskOutput, TaskGet, ToolSearch, Bash(git diff:\*), Bash(git status:\*), Bash(git add:\*), Bash(git commit:\*), Bash(git rev-parse:\*), Bash(git log:\*), Bash(git show:\*), Bash(git worktree:\*), Bash(git switch:\*), Bash(git checkout:\*), Bash(git merge:\*), Bash(git revert:\*), Bash(git branch:\*), Bash(git push:\*), Bash(gh pr create:\*), Bash(mkdir:\*), Bash(touch:\*), Bash(npm:\*), Bash(node:\*)。**実在ツールのみ列挙**（v4 の phantom `Task` を踏襲しない）。`Bash(codex exec:*)` は含めない。
    - **§1 唯一の真実**: v4 §1 同等（plan.md + tasks.json canonical id 貫通）。
    - **§2 permission ポリシー**: v4 §2 継承＋変更2点: (i) 終端の draft PR 自動作成を例外許可（push 先は origin の当該 goalflow 作業ブランチのみ・main 直 merge / PR マージ / 履歴改変は禁止のまま）、(ii) 履歴改変は settings.json deny で物理拒否（task-1 連動）。
    - **§3 単一タスク実行 (a)(b)(c)**: (b) を「**1タスク = 1 fresh subagent**」に置換: `Agent(subagent_type:'general-purpose', prompt = plan 設計4項目＋対象ファイル＋完了条件＋『成果サマリを `.codex-out/<task-id>.md` に Write せよ』)`。1 attempt = 1 subagent。再試行も新規 subagent（コンテキスト持ち越さない）。
    - **§4 commit-before-verify + baseCommit**: v4 §4 不変。verify Workflow の args は同一契約のまま、`codexSummary` に subagent 自己申告サマリ（`.codex-out/<task-id>.md` 要約）を渡す（**引数名据置・無改修**）。
    - **§5 Tier 勾配**: v4 §5 不変。
    - **§6 並列**: 候補機構 = `Agent(..., run_in_background: true, isolation: 'worktree')`（live schema 確認済・arg 実在は確定）。ただし worktree 隔離下 write の着地と待ち合わせの end-to-end は未実証 → **初回 dogfood で実証されるまで直列フォールバック必須**（v4 §6 posture 維持。未実証機構を確定機構として書かない）。
    - **§7 branch-merge バリア**: v4 §7 不変。
    - **§8 ledger（必須実装）**: `.goalflow/state/<plan-slug>.json`。**orchestrator 単独書込**（subagent は ledger を書かない。書くのは `.codex-out/<task-id>.md` のみ）。run-id = `<plan-slug>-r<連番>`（ledger 内 field。再 /loop は同ファイルを slug で引き、未完タスクから resume。新 run は連番 increment）。`startedAt`（ISO8601）を記録。状態遷移 = v4 §8 の列（created→running→committed→verified→aboutToMerge→merged→integrationOk→cleaned / failed / rolledBack）。write point: subagent 完了通知 / per-task commit / verify 完了 / merge / cleanup の各直後に orchestrator が書く。**viz 結線**: resume 時は fuse を `--since=<startedAt>` で起動する（または tasks.json を touch）旨を明記。
    - **§9 loop-until-done**: v4 §9 不変（maxAttempts=3 / maxRounds=3 / no-progress。質問は queue に溜めループ後一括返却）。
    - **§10 /loop 起動**: `/loop /goal:exec-v5 docs/plans/<slug>.md`。primary wake = Agent / Workflow 完了通知（harness 管理 = ハングクラス消滅の根拠を明記）。fallback heartbeat = ScheduleWakeup（1200〜1800s）。
    - **§11 コスト計測**: codex usage ソースを廃し、workflow journal totalTokens ＋ Agent subagent tokens ＋ session usage の read-only 集計に置換。
    - **§12 終端（draft PR まで自走）**: 全タスク verified ＋ 統合チェック後、plan の **## PR仕様** を唯一根拠に PR 本文を生成 → `git push -u origin <作業ブランチ>`（明示 push）→ `gh pr create --draft`（fallback: `mcp__github__create_pull_request` with `draft:true`）→ **停止して報告**（質問 queue・コスト・ledger 最終状態を含む）。draft→ready 化・マージ・main 統合は人間。
    - **§13 フォールバック**: verify Workflow 不可時は orchestrator 自力照合（基準不変）。並列未実証/不可時は直列で完走。
  - 影響場所と効果: `/goal:exec-v5` がコマンド一覧に載る。v3（exec.md）/ v4（exec-v4.md）は一切編集しない。viz seam（`.codex-out`・per-task commit・verify journal）は同形で踏むため goalflow-viz は無改修で動く。
  - goalへの影響: 主成果物。codex 全廃・ハングクラス消滅・/loop 自走・draft PR 終端のすべてを担う。
- [ ] task-3
  - 操作対象: `CLAUDE.md`
  - 操作内容: (i) **役割反転フロー**: 実装担当を「Codex(gpt-5.5)」から「実装 subagent（Claude・1タスク = 1 fresh subagent）」へ更新し、codex は v3/v4 の移行期間中のみと注記。(ii) **モデル方針**: 実装・修正の行を fresh subagent（Fable 5 系）へ更新。(iii) **codex 呼び出しの堅牢化（PreToolUse hook）節**: deprecate 注記（v3/v4 移行期間中のみ有効・hook 物理撤去は codex 解約と同期）を付し、実在しない `docs/plans/goal-exec-codex-large-task-hang.md` への dangling 参照を除去。(iv) **## コマンド**: `/goal:exec-v5` を追記。(v) **## 停止条件**: exec-v5 限定例外を最小追記——「`/goal:exec-v5` の自律 /loop に限り、終端の draft PR 自動作成（当該作業ブランチへの push を含む）を許可する。main 直接 merge・PR のマージ・履歴改変は引き続き禁止」。本文の原則（PR 作成は事前確認）は不変のまま。
  - 影響場所と効果: 全 PJ 共通のフロー正本が v5 と整合する。緩和は exec-v5 限定の例外条項として書かれ、他コマンド・他 PJ へ波及しない（二層構成）。
  - goalへの影響: plan-exec 契約の正本が Claude 一本化を反映し、draft PR 終端がポリシー違反でなくなる。
- [ ] task-4
  - 操作対象: `projects/-Users-ooizumiyou--claude/memory/goalflow-v4-open-threads.md`、`projects/-Users-ooizumiyou-nestify/memory/feedback_codex_ratelimit_hang.md`
  - 操作内容: 前者に v5 決定（実装者 = fresh subagent（旧2案 (a)Opus直接/(b)Sonnet実装 を更新）/ ledger 必須実装化 / draft PR 終端 / settings.json 居座り差分の解消済み）を追記。後者に「codex 撤去（exec-v5）により obsolete。v3/v4 の移行期間中のみ参照」の注記を付す。いずれも gitignore 済 harness memory への**直接ファイル編集（PR 外）**。
  - 影響場所と効果: PR diff には入らない。次 session 以降の文脈が v5 前提になる。
  - goalへの影響: 横断記憶が移行し、旧 codex 前提の提案・誤った deny 懸念（stale な memory:50）が再発しない。

## 未確定・要判断事項

1. **並列実発火の end-to-end 実証は次 goal へ**: `Agent(run_in_background, isolation:'worktree')` の arg 実在は live schema で確定済みだが、worktree 隔離下 write の着地・待ち合わせ・merge バリアとの結線は dogfood でしか確定しない。本 plan は直列フォールバックで出荷し、**exec-v5 dogfood**（別 goal）で実証後に §6 を確定機構へ昇格させる。
2. **hook 物理撤去のタイミング**: `codex-exec-guard.sh` ＋ settings.json PreToolUse 登録の削除は **codex 解約と同期する follow-up**（本 PR には含めない。v3/v4 が移行期間中 codex を使うため。残置しても v5 に実害なしは実測済）。
3. **v3/v4 の deprecate 宣言時期**: exec-v5 dogfood 完走後を想定（その時点で CLAUDE.md のコマンド一覧を整理し、hook 撤去 ＋ codex 解約を実行）。
4. **解決済（記録）**: settings.json 居座り差分 = 全部 commit（ユーザ確定 2026-06-10）／ 終端手段 = 明示 push → `gh pr create --draft`（MCP は fallback）／ `codexSummary` = 無改修流用 ／ run-id = plan slug 決定論採番 ／ 緩和スコープ = exec-v5 限定の二層構成。

## PR仕様（PR / スコープごと。/goal:exec はこの仕様どおりに PR 本文を書く）

- PR-1: DKen-DevCat/.claude / goalflow 実行レイヤーの Claude Code 一本化（/goal:exec-v5 導入）
  - 目的: codex 非依存の自律実行 controller `/goal:exec-v5` を導入し、その前提となるポリシー整合（CLAUDE.md 例外条項・settings.json deny 完全化・居座り差分解消）を同一 PR で揃える。
  - 満たすべき要件: 背景の要件 1〜8・10 のうち PR 対象分（task-1〜3）。要件9（hook 撤去）は follow-up として PR 外。
  - 着手前の立ち位置 / 完了後の立ち位置: 着手前 = 実装委譲が codex 依存（ハング有界化 hack 必須・終端は PR 提案止まり・ledger 未実装）。完了後 = `/loop /goal:exec-v5 <plan>` で fresh subagent 実装 → verify → ledger 記録 → draft PR 作成まで無人自走可能（並列は直列フォールバック）。v3/v4 は無傷で併存。
  - 作業フロー図（mermaid。本PRでの作業内容を図示）:
    ```mermaid
    flowchart TD
      A[着手前: codex依存 v3/v4 のみ] --> B[task-1 settings.json 差分commit + deny完全化]
      A --> C[task-2 exec-v5.md 新規作成<br/>subagent実装・ledger・draft PR終端]
      C --> D[task-3 CLAUDE.md v5反映<br/>役割/モデル/コマンド/停止条件例外]
      B --> E[完了後: /loop /goal:exec-v5 が<br/>draft PR まで自走可能]
      D --> E
    ```
  - 解決タスクと goal への効果: task-1（自律実行の多層防御完成）、task-2（主成果物 = ハングクラス消滅・自走・draft PR 終端）、task-3（正本整合・例外の波及遮断）。task-4 は gitignore 済 memory への直接編集のため PR 外（本 PR と同期して実施）。
  - PR外への影響: memory 2件の直接編集（diff 外）。settings.json の global model 固定（`claude-fable-5[1m]`）は全 session に効く（ユーザ確定済）。v3/v4 の実行挙動・goalflow-viz は不変。
  - Verification: `node -e "JSON.parse(require('fs').readFileSync('settings.json','utf8'))"` ＋ `node -e "JSON.parse(require('fs').readFileSync('docs/plans/goal-exec-v5-claude-native.tasks.json','utf8'))"`。md 3点（exec-v5.md / CLAUDE.md / memory）は手レビュー（共通 build/test の無い repo）。
  - その他共有事項: 作業ブランチは main から `feat/goal-exec-v5` を新規に切る（現 `feat/taskflow-viz-skill` には積まない。本 plan.md / tasks.json は untracked のためブランチ切替で持ち越し、新ブランチで最初にコミットする）。本 plan を実行する exec 自体は v3/v4（codex 経路）または人間指示によるブートストラップ実装のどちらでも成立する。
