# Goal: plan.md にタスク依存の機械可読構造を導入し、exec-v5 を「並列基本・依存のみ直列」へ改修する

## 背景（なぜ / 要件 / 前提）

**なぜ**: 現行 /goal:exec-v5 は worktree 並列（§6）が dogfood 未実証のため直列フォールバックが既定で、全タスクを1つずつ実行するため完了までの wall-clock が長い。根本原因は plan.md 側に依存宣言の構造が無く、exec が並列可否を prose から暗黙推測するしかないこと。

**要件**:
1. plan 時: タスクごとの `depends-on` / `target-files` を plan.md の明示フィールドとして構造化し、独立バッチ／直列チェーンを exec が機械的に導出できるようにする。plan 時点で並列バッチ構成を可視化する。
2. exec 時: 並列を既定とし、依存がある部分だけ直列。既存の安全機構（1タスク=1 fresh subagent・commit-before-verify＋baseCommit・branch-merge バリア・Tier 勾配・ledger 単一書込・履歴改変禁止）は維持。
3. 並列機構の未実証状態との整合: **canary 方式**（初回 run の最初の独立バッチを受け入れ条件付きで並列発火→通過で全面並列・失敗で直列降格）。
4. 並列時 commit-before-verify 規律の再設計（per-branch baseCommit・`git -C`・targets 絶対パス化）。
5. 後方互換: depends-on フィールドの無い既存 plan.md は全タスク直列とみなす。

**ユーザ決定（2026-07-13 確認済み）**:
- ロールアウト = **canary→全面並列**（dormant-until-evidence 回帰は「ありえない」と明示棄却）
- 並列許可範囲 = **Tier と切り離し・全 Tier 可**（並列可否は「depends-on なし ∧ target-files 互いに素」のみで判定。Tier は verify 深度専用）
- worktree 生成経路 = **L67: orchestrator 主導 `git worktree add <path> -b goalflow/<run-id>/<task-id> <baseCommit>`**（Agent isolation:'worktree' は不採用）
- PR 境界 = **単一 PR**（v4 task-9 先例「CLAUDE.md 正本更新は exec 変更と同一 PR・同一承認境界」に従う）

**前提**: 対象リポジトリは ~/.claude（グローバル設定リポ）。共通 build/test は無い（js のみ `node --check` 可）。

## 調査結果（goal実態 / 現状実態 / ギャップ）

調査 Workflow（goal-plan-investigate・3ラウンド・17 agents）＋多票クリティックの確定事実:

**goal実態**:
- v5 原 plan（docs/plans/goal-exec-v5-claude-native.md）自身が「並列実発火の end-to-end 実証は次 goal へ」と明示先送りしており、本 goal はその「次 goal」の履行に相当する。memory goalflow-v4-open-threads にも 2026-06-10 起票の open thread として記録済み。

**現状実態**:
- plan.md 出力 schema（commands/goal/plan.md L51-77）はタスク4項目のみで depends-on / target-files フィールド無し。exec-v5 §5/§6 の独立判定「対象ファイルが互いに素 ∧ 依存宣言なし」の判定材料が plan に存在しない。
- exec-v5 §5（L64「初回から Tier B/C 並列発火してよい」）と §6（L71「dogfood 実証まで直列フォールバック」）が同一ファイル内で矛盾。L64 は v4 の dormant-until-evidence 方針からの無記録の反転（今回ユーザ決定で canary 方式に置換し正式決着）。
- `Agent(isolation:'worktree')` は**全環境・全履歴で実行実績ゼロ**（実 Agent 呼び出し150件走査）。AgentInput に branch 名/パス指定引数なし（branch 命名 `goalflow/<run-id>/<task-id>` が原理的に不可能）、AgentOutput（全3 variant）が worktreePath/worktreeBranch を返さない（orchestrator が worktree 位置を知る手段が構造的に無い）、baseRef 実挙動（現在 branch HEAD か origin/default か）未確定。→ L67 一本化の根拠。
- §4 commit-before-verify は単一 checkout 直列前提（実 ledger 例 `.goalflow/state/goal-exec-v5-claude-native.json` で baseCommit が前タスク headCommit に線形連鎖することを実データ確認）。実 ledger のフィールドは `{state, tier, baseCommit, headCommit, note?}` のみで worktreePath/branch/batch 無し。task-4 に **baseCommit=null（gitignored ファイル直接編集）** の実例あり＝非 git target のエッジケースが schema 設計に必要。
- goal-exec-verify.workflow.js の cwd はプロンプト文字列埋め込みのみ（パス解決を切り替える機構ではない）。targets は実運用6PJ 全てで相対パス・cwd=repo ルートで乖離条件未テスト。並列 worktree では targets 絶対パス化が必要。
- §7 branch-merge バリア・§8 ledger は task-id 単位の一般形で並列を受け止める素地あり（改修必須は §4 と §6）。§8 の race-free 主張は 114/114 件の「1ターン1通知」経験観測のみで形式保証なし。
- exec-v5 frontmatter に `Bash(git worktree:*)` 許可済み＝権限面のボトルネックなし。settings.json deny（reset --hard / branch -D / rebase / commit --amend 等10パターン）は §2 と整合。

**ギャップ**（→ 実行計画へのマッピング）:
1. plan schema に依存構造なし → task-1
2. §5/§6 矛盾・並列既定化・canary 未定義・後方互換未定義 → task-2
3. §4 が直列専用 → task-3
4. ledger schema に worktreePath/branch/batch/非git フラグなし・L71/L87 確度不整合 → task-4
5. verify targets 相対パス前提 → task-5
6. CLAUDE.md 要約行の同期 → task-6
7. memory open thread の更新 → task-7

## 実行計画

> 本 plan は task-1 が導入する新フィールド（depends-on / target-files / non-git）を自己適用している。`## 並列バッチ構成` はフィールドからの導出結果であり、exec は再導出して照合し、不一致なら停止する。

- [ ] task-1: /goal:plan 出力 schema への依存構造フィールド導入
  - 操作対象: commands/goal/plan.md
  - target-files: [commands/goal/plan.md]
  - depends-on: []
  - 操作内容: (a) 手順4の dme 委譲要求に「タスク間依存（depends-on）と target-files（変更ファイルパス集合）の抽出・宣言」を必須追加。(b) 出力 schema の各 task に `target-files: [相対パス...]`（互いに素判定用）と `depends-on: [task-id...]`（空=依存なし）を必須フィールドとして追加、gitignored 等の非 git 管理 target を持つタスクは `non-git: true` を付す規定を追加。(c) `## 実行計画` の直後に `## 並列バッチ構成` セクション（フィールドから導出したトポロジカル層のバッチ表。canary バッチの明示を含む）を出力契約へ追加し、「exec は再導出して照合・不一致なら停止」を明記。
  - 影響場所と効果: 以後生成される全 plan.md が機械可読な依存構造と plan 時点の並列バッチ可視化を持つ
  - goalへの影響: 中心ギャップ（並列判定材料の欠落）を plan 段階で解消する

- [ ] task-2: exec-v5 の並列既定化（§1/§5/§6/§13）
  - 操作対象: commands/goal/exec-v5.md
  - target-files: [commands/goal/exec-v5.md]
  - depends-on: []
  - 操作内容: (a) §1 に depends-on / target-files / non-git / `## 並列バッチ構成` の読み取り規定と「フィールド無し plan は全タスク直列依存とみなす」後方互換を追記（§13 にも同旨）。(b) §5 を verify 深度専用の Tier 勾配に書き換え（並列可否から Tier を分離。`.claude/tier-policy.md` 参照は Tier 判定用に温存）。(c) §6 を正式機構化: 見出しの【候補機構・dogfood で要検証】を撤去し、**L67 = orchestrator 主導 `git worktree add <path> -b goalflow/<run-id>/<task-id> <baseCommit>` を唯一の経路**として明文化。L69（Agent isolation:'worktree'）は不採用理由（branch 命名不可・AgentOutput が位置を返さない・実行実績ゼロ・baseRef 未確定）を注記して撤去。実装 subagent は通常 spawn（`run_in_background: true`）で prompt に worktree 絶対パスを明記し、prompt 末尾に「`git rev-parse --show-toplevel && git branch --show-current` の結果を `.goalflow/out/<task-id>.md` 冒頭へ自己申告せよ」を必須追加。(d) **canary 規律の新設**: 初回並列 run の最初の独立バッチを canary とし、受け入れ条件 = ①worktree add 成功・ledger 記録 ②並列 spawn 全員の完了通知受領 ③書込封じ込め（`git -C <worktreePath> status --porcelain` が target-files 内のみ ∧ main checkout に予期せぬ変更なし） ④近接完了後の ledger JSON 整合 ⑤per-branch diff で verify 通過 ⑥バリア merge＋統合チェック通過。全通過→残バッチ全面並列。1つでも失敗→当該 run は直列降格（§13）し ledger に記録して続行。**降格前クリーンアップ（条件③破れの場合に必須）**: `git status --porcelain` で main checkout 上の予期せぬ変更を特定し、未コミット分は `git checkout -- <file>` で破棄・コミット済みなら `git revert` で切り離してから、直列パスの baseCommit を再取得する（汚染を含んだ HEAD を baseline にしない。`reset --hard` は使わない）。(e) exec 開始時に orchestrator が Agent/Workflow の live schema を再確認する受け入れ条件を追記（sdk-tools.d.ts 2.1.193 と実行バイナリ 2.1.207 の乖離対策）。(f) L71/L87 の確度不整合（write 着地「未検証」vs「前提」）を canary 前提の記述に統一。
  - 影響場所と効果: exec-v5 の既定が「並列基本・依存のみ直列・canary ゲート付き」になる
  - goalへの影響: goal の中核。§5/§6 矛盾の解消と並列既定化そのもの

- [ ] task-3: exec-v5 §4 commit-before-verify の並列対応再設計
  - 操作対象: commands/goal/exec-v5.md
  - target-files: [commands/goal/exec-v5.md]
  - depends-on: [task-2]
  - 操作内容: §4 を二相構成に書き換え。**直列時**: 現行どおり（spawn 直前 `git rev-parse HEAD` → per-task commit → `git diff baseCommit..HEAD -- targets`）。**並列時**: baseCommit = worktree add 時点の統合 branch HEAD（バッチ内全 worktree で共通・`git worktree add` の引数に明示指定）、per-task commit は `git -C <worktreePath> add <target-files>... && git -C <worktreePath> commit`、verify への注入は `diffText = git -C <worktreePath> diff <baseCommit>..HEAD -- <targets>`・`cwd = <worktreePath>`・**targets は worktree 起点の絶対パス**。non-git タスク（baseCommit=null）は worktree/バリア不適用の直列扱いと明記。
  - 影響場所と効果: verifier が並列時も「真の task 差分のみ」を根拠にできる（goal-exec-verify.workflow.js の lockdown 契約は無改修で維持）
  - goalへの影響: 並列時の検証根拠の正しさを担保する（これ無しの並列化は verify を壊す）

- [ ] task-4: exec-v5 §8 ledger schema の並列拡張
  - 操作対象: commands/goal/exec-v5.md
  - target-files: [commands/goal/exec-v5.md]
  - depends-on: [task-3]
  - 操作内容: per-task フィールドに `worktreePath` / `branch` / `batch`（バッチ ID）/ `nonGit` を追加（現行実フィールド `{state, tier, baseCommit, headCommit, note?}` からの拡張として現状ベースラインを注記）。worktreePath の「取得→ledger 保持→per-task commit・verify cwd・cleanup への伝播」を単一の伝播規約として明文化（情報源は orchestrator 自身の `git worktree add` 引数＝自己申告に依存しない一次情報。subagent 自己申告は照合用）。race-free 記述は「単一書込点＋canary ④で近接完了時の整合を実地観察する」という確度に揃える。
  - 影響場所と効果: 並列 run の resume・cleanup・監査が ledger だけで再構成可能になる
  - goalへの影響: 並列状態の追跡と canary 判定の記録土台

- [ ] task-5: goal-exec-verify.workflow.js の targets 絶対パス化ガード
  - 操作対象: workflows/goal-exec-verify.workflow.js
  - target-files: [workflows/goal-exec-verify.workflow.js]
  - depends-on: []
  - 操作内容: args 受領部に正規化ガードを追加: `targets` の相対パスは `cwd` 起点で絶対パス化してからプロンプトへ埋め込む（`cwd` 未指定で相対 targets が来た場合は明示エラーを返す）。`cwd` には並列時 worktree 絶対パスが渡り得ることをコメントで契約化。VERDICT 算出ロジック・lockdown（verifier は自前 git 禁止・diffText のみ根拠）は不変。完了条件: `node --check` に加え、最小スモークテスト（`node -e` 等で正規化ロジックを直接実行）で ①`cwd`＋相対 targets→絶対パス化される ②`cwd` 未指定＋相対 targets→明示エラーになる、の2ケースを実行確認する。
  - 影響場所と効果: 並列 worktree 下でも verifier が正しいファイルを Read できる（乖離条件未テストだった相対パス解決の穴を塞ぐ）
  - goalへの影響: 並列時 verify の実効性を機構側でも担保

- [ ] task-6: CLAUDE.md「## exec 制御」の同期
  - 操作対象: CLAUDE.md（~/.claude/CLAUDE.md）
  - target-files: [CLAUDE.md]
  - depends-on: [task-2, task-3, task-4]
  - 操作内容: 「※並列は dogfood 未実証のため直列フォールバックが既定」を「並列が既定（plan.md の depends-on / target-files から独立バッチを導出。初回並列 run は canary 受け入れ条件付き・失敗時直列降格）」へ書き換え。「## plan-exec 契約」に plan schema 拡張（depends-on / target-files / 並列バッチ構成）を1行反映。要点のみ・詳細は exec-v5.md §1-13 正本という参照構造は維持。
  - 影響場所と効果: 正本（exec-v5.md）と要約（CLAUDE.md）の不整合を防ぐ（v4 task-9 の同一 PR 同期先例に従う）
  - goalへの影響: 全セッションが新既定を正しく認識する

- [ ] task-7: memory open thread の更新
  - 操作対象: projects/-Users-ooizumiyou--claude/memory/goalflow-v4-open-threads.md（および MEMORY.md の該当行）
  - target-files: [projects/-Users-ooizumiyou--claude/memory/goalflow-v4-open-threads.md, projects/-Users-ooizumiyou--claude/memory/MEMORY.md]
  - depends-on: [task-6]
  - non-git: true
  - 操作内容: 「並列実発火 dogfood」thread を「並列既定化＋canary 設計 landed（本 plan の PR）。実機実証は次回並列 run の canary バッチで完了予定。L69 不採用・L67 一本化の決定と根拠を記録」に更新。
  - 影響場所と効果: 引き継ぎ点の現行化（gitignored・PR 外の直接編集）
  - goalへの影響: 次セッションの再調査コストを消す

## 並列バッチ構成

（depends-on / target-files からの導出。本 plan の実行自体が canary dogfood を兼ねる）

| バッチ | タスク | 実行様式 | 根拠 |
|---|---|---|---|
| batch-1 | task-1, task-2, task-5 | **並列（canary）** | 相互に depends-on なし ∧ target-files 互いに素（plan.md / exec-v5.md / workflow.js） |
| batch-2 | task-3 | 直列 | task-2 と同一 target（exec-v5.md）＋依存 |
| batch-3 | task-4 | 直列 | task-3 に依存（同一 target） |
| batch-4 | task-6 | 直列 | task-2/3/4 の確定文言に依存 |
| batch-5 | task-7 | 直列（non-git・worktree/バリア不適用） | gitignored 直接編集（baseCommit=null 実例と同型） |

batch-1 が canary: task-2(d) の受け入れ条件①〜⑥を本 run でそのまま観察する。全通過で以降の goal でも並列既定が実証済みになる。失敗時は本 run を直列降格して完走し、失敗様態を ledger と PR 本文に記録する。

## 未確定・要判断事項

決定済み（ユーザ確認 2026-07-13）: ロールアウト=canary→全面並列（dormant 回帰は棄却）/ 並列範囲=全 Tier 可（Tier は verify 深度専用）/ worktree 経路=L67 一本化 / PR 境界=単一 PR。

残存 ⚖️（plan 承認をもって以下の提案どおりに進める。異論があれば編集を）:

1. ⚖️ **ledger race-free は形式保証なし**（114/114 の経験観測のみ）。提案: canary 受け入れ条件④（近接完了時の ledger JSON 整合の実地観察）で運用担保とし、破損検知時は直列降格。形式保証を追う場合は別 goal。
2. ⚖️ **subagent の書込封じ込めは prompt 指示＋事後検証のみ**（Agent tool に cwd 強制引数が存在しないことは一次情報で確定）。提案: canary 条件③（`git -C status --porcelain` の target-files 内限定 ∧ main checkout 無変更）を全並列タスクの標準検証とし、逸脱は差し戻し（新 fresh subagent）。
3. ⚖️ **depends-on の語彙**: harness TaskCreate の `blockedBy` に揃えず plan 固有語彙 `depends-on` を採用する提案（exec-v5 は Agent/Workflow ベースで harness task 機構と未結線のため。将来接続時に alias 可能）。
4. ⚖️ **調査の未検証クレーム**: sdk-tools.d.ts（npm 2.1.193）と実行バイナリ（2.1.207）の契約乖離の可能性。提案: task-2(e) の「exec 開始時 live schema 再確認」で吸収。
5. ⚖️ **canary 失敗時の粒度**: 提案は「当該 run 全体を直列降格」（バッチ単位の部分降格は複雑化に見合わない）。より細かい降格が必要なら編集を。

## PR仕様（PR / スコープごと。/goal:exec-v5 はこの仕様どおりに PR 本文を書く）

- PR-1: ~/.claude（グローバル設定リポ）/ goal フロー全体（plan schema＋exec 並列既定化＋verify ガード＋正本同期）
  - 目的: /goal:plan が依存構造（depends-on / target-files / 並列バッチ構成）を plan.md に構造化出力し、/goal:exec-v5 が「並列基本・依存のみ直列・canary ゲート付き」で駆動する構成へ両コマンドと関連機構を単一 PR で改修する
  - 満たすべき要件: 背景節の要件1〜5（依存構造の plan 時確定 / 並列既定＋安全機構維持 / canary 方式 / §4 並列規律 / 後方互換）
  - 着手前の立ち位置 / 完了後の立ち位置: 着手前 = 並列は「候補機構・未実証」で直列既定・plan に依存構造なし・§5/§6 矛盾。完了後 = plan.md が機械可読な依存構造と並列バッチ可視化を持ち、exec-v5 は L67 経路の並列が既定（canary 受け入れ条件付き）、verify は worktree 対応、CLAUDE.md/memory 同期済み
  - 作業フロー図（mermaid。本PRでの作業内容を図示）:
    ```mermaid
    flowchart TD
      A[着手前: 直列既定・依存構造なし・§5/§6矛盾] --> B[batch-1 並列canary]
      B --> B1[task-1 plan.md schema拡張]
      B --> B2[task-2 exec-v5 並列既定化]
      B --> B3[task-5 verify targets絶対パス化]
      B1 & B2 & B3 --> C{canary受け入れ条件①-⑥}
      C -->|全通過| D[task-3 §4並列再設計]
      C -->|失敗| S[直列降格で残タスク続行＋失敗様態記録]
      D --> E[task-4 ledger拡張]
      E --> F[task-6 CLAUDE.md同期]
      S -.-> D
      F --> G[task-7 memory更新 non-git直列]
      G --> H[完了後: 並列基本・依存のみ直列・canary実証済み → draft PR]
    ```
  - 解決タスクと goal への効果: task-1〜7 の全て。task-1 が判定材料を作り、task-2〜5 が並列実行系を成立させ、task-6/7 が正本・引き継ぎを同期する。本 PR の実行過程（batch-1）自体が canary dogfood となり、「並列実発火未実証」の open thread を実機証拠付きで前進させる
  - PR外への影響: 全プロジェクト横断で /goal:plan・/goal:exec-v5 の挙動が変わる（既存の依存フィールド無し plan.md は直列フォールバックで挙動不変）。deep-review・phase-* 等の他コマンドへの影響なし。.goalflow/ ledger は gitignored のため PR diff 外
  - Verification: `node --check workflows/goal-exec-verify.workflow.js`（js 構文ゲート。各 merge 後の統合チェックでも実行）。md 3ファイル（plan.md / exec-v5.md / CLAUDE.md）は共通 build/test の無い repo のため手レビュー（orchestrator の diff 精読＋plan 設計4項目照合）。加えて canary 受け入れ条件①〜⑥（task-2(d)）を batch-1 の実行時検証とする。さらに PR 完了前チェックとして (a) task-5 のスモークテスト2ケース（相対→絶対パス化・cwd 未指定エラー）の実行確認、(b) 後方互換の回帰確認 — depends-on フィールドを持たない既存 plan.md（例: docs/plans/goal-exec-v5-claude-native.md）を改修後 exec-v5 §1 の読み取り規定に照らし、全タスク直列依存と判定されることを確認 — を含める
  - その他共有事項: (1) **本 plan の batch-1 並列発火は、現行 exec-v5 §6 の「dogfood 実証まで直列」が待っていた dogfood そのものであり、本 plan の人間承認をもって発火を承認済みとする**。(2) task-2/3/4 は同一ファイル（exec-v5.md）のため必ず直列チェーン（バリア merge を挟む）。(3) task-7 は non-git（gitignored 直接編集）のため commit/worktree/バリア対象外＝実 ledger の baseCommit=null 先例と同処理。(4) ブランチ運用: exec-v5 の run-id 規則に従い作業ブランチを新設（現ブランチ feat/deep-review-skill には積まない）。base は main
