# Goal: 役割反転フローを v4 化し、Codez記事の未採用パターンの有効分を取り込む

役割反転フロー（`/goal:plan` / `/goal:exec`）に、Dynamic Workflows 6パターンのうち**まだ採っていない有効分**を取り込み、次の4つを獲得する。**dme の moat 原則（Propose, don't decide）と invariant（1 task attempt = 1 codex call）は保ったまま。**

- (a) **設計判断の広さ** — トーナメント（割れ返し型）で、安全に広く生成して選ぶ
- (b) **検証コストの最適化** — 制御の勾配（Tier 分類 + 差し戻し集計）で、検証を高EVタスクへ集中
- (c) **独立タスクの並列化** — worktree + branch 隔離 + 直列 branch-merge バリアで、速度と統合の正しさを両立
- (d) **完了までの自走** — loop-until-done（質問バッチ + ハードストップ例外 + 終了保証）

> 本 plan は codex(gpt-5.5) の敵対的レビュー（`.codex-out/plan-review-v4.md`、総合判定=差し戻し）を受けて改訂した v2。指摘13件を全タスクに反映済み（末尾「レビュー反映表」参照）。

## 背景（なぜ / 要件 / 前提）

**なぜ**: 現行 v3 は記事の中核2パターン（fan-out-and-synthesize / adversarial verification）を既に実装し、「Codex 実装 / Claude 判定」のモデル横断で記事を超えている。一方 tournament・loop-until-done は未採用、検証は全タスク一律ゲート（過剰制御の可能性）、独立タスクも直列。これらは記事の menu から取れる有効な余地。

**要件**:
- invariant「**1 task attempt = 1 codex call**（並列 fan-out で同一 task を複数 codex に投げない。差し戻し再試行は新しい attempt）」「codex は Workflow の外（top-level）」を壊さない。
- dme の moat 原則を壊さない（高 stakes 判断は人間に返す）。
- **挙動と正本を一致させる**: exec の挙動を変える PR-2 では、フロー正本 `CLAUDE.md` を**同一承認境界**で更新する（人間決定 (i)）。
- 制御の勾配・独立性判定の最終パラメータは**事前に決めず**、loop が証拠（差し戻し集計・統合チェックのヒット）を集めて**完了後に人間へ報告**する。
- トークン予算上限は設けない（運用上 5h 枠が外部 backstop）。ただし**終了はロジックで保証**し、中断時は ledger で復旧可能にする。

**前提**:
- 対象は `~/.claude` リポジトリ内の harness 定義ファイル群（commands / workflows / CLAUDE.md）。全て本対話で全文既読。
- 入力（goal/要件）は信頼ソースのため quarantine パターンは本 goal の対象外。
- 本 plan の**初回実行は現行（直列）の `/goal:exec`** で行う。新しい並列/loop 挙動が効くのはマージ後の**次回以降の goal** から。そのため初回実装の Verification（`node --check` 等）は exec の現行権限では走らない → **初回のみ Claude の実ファイル照合＋人間の `!` 実行で確認**する（task-4 参照）。
- merge 方式は **branch-merge**（タスク単位のコミット履歴を PR に残す。人間決定 2）。
- ロールアウトは **dormant-until-evidence**（初期は全 Tier A で並列は事実上眠らせ、差し戻し集計が B/C 格下げを提案してから並列が発火。人間決定 3）。

## 調査結果（goal実態 / 現状実態 / ギャップ）

**goal実態（記事の未採用パターン）**:
- Tournament = ペア比較。絶対採点が崩れる「センス・好み」判断で信頼でき、広く生成しても選択が崩れないため生成の蓋を外す。
- Loop until done = 固定回数でなく停止条件まで回す。
- 制御の勾配 = 検証は保険。掛け捨て（出ないゲート）を減らし高EVに集中。
- worktree + branch 隔離 = 並列ミューテーションの衝突回避（共有 working tree が直列を強制している実態への解）。

**現状実態（既読ファイル）**:
- `commands/goal/plan.md`: intake → investigate workflow → dme synthesis → plan.md → 停止。tournament 段なし。dme に複数候補を必須化する schema なし。出力に検証コマンド宣言なし。
- `commands/goal/exec.md`: タスクを直列に (a)明確化 → (b)codex exec（top-level / `--sandbox workspace-write`・**未コミット差分を作るだけ**）→ (c)verify workflow → Opus 判定 → 乖離時 (b)へ差し戻し再試行。**全体を包む loop-until-done / 終了ガードは無い**（タスク内の差し戻し再試行はある）。全タスク同一ゲート。frontmatter allowed-tools は `git diff/status, codex exec, mkdir` のみで **worktree/branch/commit/merge/revert・test/build 実行は不許可**。
- `workflows/goal-plan-investigate.workflow.js`: 並列 probe + 多票 critic（coverage/grounding/risk）。critic は**単発**。`perSide` は budget スケール済み。
- `workflows/goal-exec-verify.workflow.js`: 多票 verifier（design-match/side-effects/completion, read-only）。並列流用可能。

**ギャップ**:
1. plan に tournament 段がない／dme が複数候補を出す保証がない。
2. plan 出力に検証コマンド（Verification）宣言がない → exec の B/C ゲートが実行できない。
3. investigate critic が単発（consensus 自動収束なし）。
4. exec の frontmatter が worktree/branch/merge/test を許可していない。
5. exec の検証が一律（Tier 分岐・差し戻し集計なし）。
6. exec が直列固定（worktree+branch 並列・branch-merge バリア・ledger・resume なし）。
7. exec に loop-until-done・質問キュー・主 loop 終了保証がない。
8. 正本 CLAUDE.md が並列/loop と不整合（更新タイミングを挙動変更と揃える必要）。

## 実行計画

### PR-1（plan フェーズ強化）

- [ ] task-1: plan.md に tournament（割れ返し型）と「複数候補必須」を追加
  - 操作対象: `commands/goal/plan.md`（手順4 dme ループ / 手順6 PR境界）
  - 操作内容: dme 段で「**競合する設計/PR境界候補を最低2案出す。単一解が妥当なら理由を明記**」を必須化（5a 対策）。候補が複数の時、ペア比較トーナメントを回す。**実行級の比較（正しさ/きれいさ/idiomatic）は champion を採用、基準級の分岐（候補が異なる軸で勝つ）は champion を強制せず ⚖️ として「## 未確定・要判断事項」へ直列化**。
  - 影響場所と効果: 設計候補が複数ある goal で選択の信頼性が上がり、安全に広く生成できる。tournament が空振りしない。
  - goalへの影響: (a) 設計判断の広さ。dme の ③基準 moat は保持。

- [ ] task-2: plan.md 出力に「Verification 宣言」を追加
  - 操作対象: `commands/goal/plan.md`（出力 schema / PR仕様）
  - 操作内容: 各 PR / スコープに **検証コマンド（build/test）を明示する `Verification` フィールド**を追加。exec の Tier B/C ゲートと統合チェックはこれを唯一の根拠に実行する。
  - 影響場所と効果: exec 側が repo ごとの検証手段を一意に解決できる（2d 対策）。
  - goalへの影響: (b)(c) の前提を成立させる。

- [ ] task-3: goal-plan-investigate の critic consensus を真のループ化
  - 操作対象: `workflows/goal-plan-investigate.workflow.js`
  - 操作内容: 単発 critic を、`consensusComplete=false` の時に `missingAngles` を対象に再 probe → 再 critic するループへ。**max-rounds と K 連続無進捗で必ず終了**（既存 `budget` backstop も併用）。返却 schema は後方互換維持。
  - 影響場所と効果: 調査の抜けを自動で埋め、Opus の手動補完依存を減らす。
  - goalへの影響: plan 側にも loop-until-done を適用。

### PR-2（exec フェーズ強化 + 正本同時更新）

- [ ] task-4: exec.md の frontmatter allowed-tools を更新
  - 操作対象: `commands/goal/exec.md`（frontmatter）
  - 操作内容: worktree+branch 並列・branch-merge・統合チェック・resume に必要な Bash 許可を**実コマンド単位で完全列挙**する — `git worktree`, `git branch`, `git switch`/`checkout`, `git add`, `git commit`, `git merge`, `git revert`, `git reset`（local 限定・task-7 の境界に従う）, `git rev-parse`/`git log`/`git show`（resume の SHA 照合）, `rm`（worktree 後始末）, および task-2 の Verification 実行手段（`node --check`・repo の test/build）。
  - ⚠️ chicken-and-egg: **本 plan の初回実装は現行 `/goal:exec` の権限で動く**ため、PR-1/PR-2 の Verification（`node --check` 等）は task-4 完了前は exec から実行できない。初回のみ **Claude が実ファイルを読んで照合 ＋ 人間が `! node --check ...` を実行**して確認する（task-4 がマージされた後の goal から exec が自走実行できる）。
  - 影響場所と効果: task-5〜8 が許可面の壁で詰まらない（2a 対策）。
  - goalへの影響: (b)(c)(d) の実行可能性を担保。

- [ ] task-5: 制御の勾配（Tier A/B/C + 差し戻し集計）を exec.md に導入
  - 操作対象: `commands/goal/exec.md`（(a)(c)段）
  - 操作内容: Tier 判定基準を追記 — **A**=セキュリティ/認証/データ移行/公開API契約・「静かに間違うと高くつき、テストで捕まらない」、**B**=テスト被覆ありロジック、**C**=機械的/config/docs。検証段(c)を Tier 分岐 — A=フル3レンズ verify+Opus 判定、B=軽ゲート（Verification の test/build）、C=信頼+Verification+branch-merge バリアのみ。**差し戻し（=各 attempt）をタスク種別ごとに集計**（既存 verdict/`.codex-out` から集計、新規計測不要）。**初期は全タスク Tier A 相当（dormant-until-evidence）**、集計が「この種別は N attempt 通して差し戻し0 → 格下げ可」を loop 完了後の報告質問として返す。**人間が承認した Tier 格下げは対象 repo の `.claude/tier-policy.md`（無ければ全 Tier A）に永続化し、次回 goal の Tier 判定の初期値に使う**（5b 対策）。**plan に Verification が無い／許可外コマンドの場合は exec を停止**して人間に返す（2d 対策）。
  - 影響場所と効果: 検証コストを高EVに集中。並列は格下げ後に発火する設計（5b を意図として明記）。
  - goalへの影響: (b)。dme 原則「実行は AI 強い側=遠慮しない」との整合。

- [ ] task-6: 独立バッチの worktree+branch 並列実行（codex 並列 + verify 並列 + ledger）
  - 操作対象: `commands/goal/exec.md`（(b)(c)段）
  - 操作内容: 独立判定（**target 互いに素 ∧ 依存宣言なし ∧ Tier B/C**）でタスクを束ね、各タスクを **git worktree + 専用 branch（`goalflow/<run-id>/<task-id>`）** に分離。codex を **top-level 並列**起動（1 attempt = 1 codex call の invariant 維持・Workflow の外を維持）。各 worktree で **codex 変更を commit**（branch-merge の前提）。各 worktree の diff を既存 `goal-exec-verify` workflow で**並列**検証。**ledger（`.goalflow/state/<run-id>.json`）**に各タスクの状態を**単一の状態機械**で記録: `created → running → committed → verified → aboutToMerge → merged → integrationOk → cleaned`、分岐 `failed` / `rolledBack`。各エントリに worktree path・branch 名・**base SHA / branch SHA / merge SHA** を記録（resume の SHA 照合と 2c/4b 対策の基盤。状態機械の遷移コードは exec 段で codex が実装）。
  - 影響場所と効果: 独立タスク群の wall-clock 短縮。状態が ledger で追跡可能。
  - goalへの影響: (c) の並列本体。

- [ ] task-7: 直列 branch-merge バリア（統合チェック + rollback + cleanup + resume）
  - 操作対象: `commands/goal/exec.md`（task-6 の後段）
  - 操作内容: Opus が verified branch を **1つずつ base へ merge**（`git merge --no-ff` で各タスクを履歴に残す。ledger `aboutToMerge`→`merged`、merge SHA 記録）。**各 merge 後に Verification の統合チェック**を実行し、通れば `integrationOk`→`git worktree remove`→`cleaned`。**ポリシー（design 制約。正確な git 手順は exec 段で codex が確定）**: (i) 独立のはずのタスクで **merge conflict** が出たら独立判定が誤り → その branch を捨て当該タスクを**直列バッチへ回す**。(ii) **統合チェック失敗**は当該 merge を rollback（ledger `rolledBack`）→ タスクを (b)へ差し戻し。**resume**: ledger と base を SHA で照合し、`merged` だが `integrationOk` でない（=merge 後・統合チェック前に中断）エントリは**統合チェックを再実行してから前進**、未完 worktree は破棄。**安全は隔離でなくこの統合再チェックに依存**と明記。統合チェックが相互作用を捕まえたら独立性判定を厳格化する旨も注記。
  - 影響場所と効果: 並列の取り込みを再シリアライズして正しさ担保。中断時もマージ済みは base に確定・未完は破棄でクリーン（4b の主張を機構で裏付け）。
  - goalへの影響: (c) の安全性。**用語分離 / rollback 境界（6b 対策）**: 「base への local merge（push 前）」と push 前の local revert は**自走対象**。`git reset` を使う場合も **push 済み履歴には触れない**ことを条件とする。**push 済み履歴の改変・外向き merge / PR merge / branch 削除は task-8 の hard-stop**（正本「履歴改変は事前確認」に整合）。

- [ ] task-8: loop-until-done（質問バッチ + ハードストップ例外 + 主 loop 終了保証）
  - 操作対象: `commands/goal/exec.md`（全体進行制御 / 中断条件節）
  - 操作内容: 全 plan タスクが「**merged かつ統合チェック通過**」になるまで loop。**実行級の質問は queue に溜め完了後に一括提示**。例外として **(a) goal/要件に効く分岐 と (b) 外向き操作（外向き merge / PR 作成 / branch 削除）は即停止**して確認（local integration merge は自走で、即停止対象ではない＝6b）。**主 loop 終了保証**: タスク単位 `maxAttempts`、batch 単位 `maxRounds`、**verdict/diff signature による no-progress 判定**（同一署名が連続したら打ち切り）。打ち切ったタスクは未解決として質問 queue へ（4a 対策）。トークン予算上限は無し、終了は上記ロジックで保証。
  - 影響場所と効果: 完了まで自走、割り込みを完了後集約、無限ループと quota 途中死を防ぐ。
  - goalへの影響: (d)。

- [ ] task-9: 正本 CLAUDE.md を v4 化（PR-2 と同一承認境界）
  - 操作対象: `~/.claude/CLAUDE.md`（役割反転フロー / モデル方針 / plan-exec 契約 / 停止条件）
  - 操作内容: invariant を「**1 task attempt = 1 codex call**（並列 fan-out で同一 task を複数 codex に投げない）」へ再定義（3b）。「codex は top-level 同期で 1 タスクずつ・直列」を「**独立 ∧ Tier B/C は worktree+branch で並列可、依存/Tier A は直列**」へ更新。loop-until-done・質問バッチ・local merge と外向き操作の hard-stop 境界・制御の勾配を反映。
  - 影響場所と効果: 挙動（PR-2）と正本が一致し矛盾が消える（3a/6a 対策）。
  - goalへの影響: dme moat（フロー変更は正本が唯一の反映点）の遵守。**PR-2 と不可分**（同時承認・同時マージ）。

## 未確定・要判断事項

- ⚖️ **制御の勾配の最終ライン**: A/B/C の最終配置は事前に決めない。task-5 の差し戻し集計が loop 完了後にデータ付きで格下げを提案 → 人間が決める。初期は全 Tier A。
- ⚖️ **独立性判定の厳格度**: 初期は「互いに素 ∧ 依存なし ∧ Tier B/C」の最保守。task-7 の統合チェックが相互作用を捕まえたら厳格化（loop が報告）。
- 終了ガードの具体値（`maxAttempts` / `maxRounds` / K）と branch/ledger 命名・path は task-6/7/8 実装時に確定（実装詳細）。
- ⚖️ tournament の「割れた」判定粒度（どれだけ軸が違えば split か）は task-1 で sonnet verifier の判定基準として具体化。

## PR仕様（PR / スコープごと。/goal:exec はこの仕様どおりに PR 本文を書く）

- PR-1: `~/.claude`（plan フェーズ強化 / task-1 + task-2 + task-3）
  - 目的: `/goal:plan` に「設計の広さ（tournament 割れ返し）」「検証コマンド宣言」「調査網羅性の自動収束」を入れる。
  - 満たすべき要件: tournament は候補複数時のみ起動・基準級は ⚖️ で返す / dme は最低2候補（単一は理由付き）/ 出力に Verification 宣言 / critic ループは max-rounds・K 無進捗で必ず終了 / 返却 schema 後方互換。
  - 着手前 / 完了後の立ち位置: 単発選択・単発 critic・検証コマンド未宣言 → 競合候補の信頼選択・consensus 自動収束・検証コマンド宣言済み。
  - 作業フロー図（mermaid）:
    ```mermaid
    flowchart TD
      A[goal intake] --> B[investigate fan-out probes]
      B --> C{critic consensus?}
      C -->|no かつ rounds<max かつ 進捗あり| D[missingAngles 再probe] --> C
      C -->|yes / max-rounds / K無進捗| E[dme synthesis ≥2候補]
      E --> F{設計候補 複数?}
      F -->|yes| G[ペア比較トーナメント]
      G --> H{基準が割れた?}
      H -->|yes| I[⚖️ 未確定へ]
      H -->|no| J[champion採用]
      F -->|no| J
      I --> K[plan.md 出力 + Verification宣言]
      J --> K
    ```
  - Verification: workflow JS の構文確認（`node --check workflows/*.js`）と plan.md の手 review。**初回実装時は exec 権限外のため、Claude 照合＋人間が `! node --check workflows/*.js` を実行**して確認。
  - 解決タスクと goal への効果: task-1（(a)）, task-2（(b)(c) の前提）, task-3（網羅性）。
  - PR外への影響: investigate の返却 schema を後方互換に保つため exec 側への影響なし。
  - その他共有事項: tournament・critic とも sonnet で実装（コスト方針維持）。

- PR-2: `~/.claude`（exec フェーズ強化 + 正本同時更新 / task-4〜9）
  - 目的: `/goal:exec` に「制御の勾配」「worktree+branch 並列 + 直列 branch-merge バリア」「loop-until-done」を入れ、**同時に正本 CLAUDE.md を v4 化**して挙動と正本を一致させる。
  - 満たすべき要件: invariant（1 attempt=1 codex / codex top-level）維持 / 安全は branch-merge バリアの統合再チェックに依存 / 実行級質問のみ完了後バッチ・(a)(b) 即停止・local merge は自走 / 予算上限なしでも maxAttempts・maxRounds・no-progress で必ず終了 / ledger で resume 可 / 初期は全 Tier A（dormant-until-evidence）/ **CLAUDE.md 更新を本 PR に含め同時承認・同時マージ**。
  - 着手前 / 完了後の立ち位置: 全タスク一律ゲート・直列・無 loop・正本不整合 → Tier 別ゲート・独立バッチ並列・完了まで自走・正本整合。
  - 作業フロー図（mermaid）:
    ```mermaid
    flowchart TD
      A[approved plan.md + Verification宣言] --> B{Tier A/B/C + 独立性判定}
      B -->|依存 / Tier A| C[直列: codex→Tier別verify→Opus判定]
      B -->|独立 ∧ Tier B/C| D[worktree+branch 分離 / ledger:created]
      D --> E[並列 codex 1attempt=1call → worktreeでcommit]
      E --> F[並列 verify]
      F --> G[[直列 branch-merge バリア]]
      G --> G1[1つずつ base merge / ledger aboutToMerge→merged]
      G1 --> G2[統合チェック build/test]
      G2 -->|失敗| H1[revert + 差し戻し or 直列化]
      G2 -->|成功| G3[git worktree remove]
      C --> I{全タスク merged & 統合OK?}
      G3 --> I
      H1 --> I
      I -->|no かつ attempts<max かつ 進捗あり| B
      I -->|maxAttempts / no-progress| J1[未解決を質問queueへ]
      I -->|yes| J[差し戻し集計 → 質問queue]
      J1 --> K[完了報告 ※外向きmerge/PR=即確認]
      J --> K
    ```
  - Verification: `node --check workflows/*.js` と、最小 goal でのドライ実行（独立2タスクの worktree 並列→branch-merge→cleanup が ledger 通り回るか）。**初回実装時は exec 権限外のため Claude 照合＋人間の `!` 実行で確認**。task-4 マージ後の goal から exec が自走で実行。
  - 解決タスクと goal への効果: task-5（(b)）, task-6+7（(c)）, task-8（(d)）, task-4（実行可能性）, task-9（正本整合・dme moat）。
  - PR外への影響: 既存 `goal-exec-verify` workflow を並列流用するのみ（同 workflow の変更なし）。`.goalflow/state/` を新設（gitignore 対象に追加）。
  - その他共有事項: 初回はこの plan 自体を**現行（直列）exec** で実装。新挙動は次回 goal から有効。

## レビュー反映表（codex 指摘13件 → 対応）

| # | codex 指摘 | severity | 対応タスク |
|---|---|---|---|
| 1-1 | 「loop なし」表現が広すぎる | low | 現状実態を補正済 |
| 2a | allowed-tools 不足 | high | task-4 |
| 2b | merge 機構未定義 | high | task-6(commit)+task-7(branch-merge) |
| 2c | cleanup/ledger 不足 | high | task-6(ledger)+task-7(cleanup/resume) |
| 2d | B/C 検証コマンド不能 | medium | task-2(宣言)+task-5/7(参照・無ければ停止) |
| 3a | 正本矛盾 | high | task-9（PR-2 同一境界） |
| 3b | invariant 定義曖昧 | medium | task-9（1 attempt=1 call 再定義） |
| 4a | 主 loop 終了未保証 | high | task-8（maxAttempts/maxRounds/no-progress） |
| 4b | quota 途中死クリーン未担保 | high | task-6/7（ledger+checkpoint+resume） |
| 5a | tournament 空振り | medium | task-1（≥2候補必須） |
| 5b | (b)/(c) 相互に弱い | medium | task-5/6（dormant-until-evidence を意図として明記） |
| 6a | 正本後回しが moat と矛盾 | high | task-9（同時更新=人間決定 i） |
| 6b | merge の hard-stop 対象が曖昧 | high | task-7/8（local merge=自走 / 外向き=hard-stop） |

> **codex 再レビュー(r2) 反映**: r2 で partial だった 2a/2b/2c/2d/4b/5b/6b を本改訂で closure（allowed-tools 完全列挙＋chicken-and-egg / merge・rollback ポリシー / ledger 状態機械＋SHA＋merged-未検証の resume / Verification 欠落停止 / Tier 永続先 / rollback 境界）。**残るのは実装詳細**（正確な git 手順・状態機械コード・終了ガード具体値）で、これは exec 段で codex が実装し verify workflow + Opus が実態検証する責務 → plan としては完成と判定。
