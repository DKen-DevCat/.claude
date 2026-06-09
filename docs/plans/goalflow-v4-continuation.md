# Goal: goalflow v4 を「achievable な範囲で完成・実証明」する（verify fix + plan側 v4 証明 / exec側証明は gate 付き次サイクル）

~/.claude 開発フロー v4 のうち、**#12 マージ不要で moat ゼロで完走できる範囲**を今サイクルで仕上げ・実証明する:
(1) `goal-exec-verify.workflow.js` の side-effects false-positive を候補A（prompt lockdown）で解消し、(2) plan側 v4（investigate 早期収束・residual escalate）を実 goal で実証明し、(3) verify fix の効力を before/after dry-run で実証する。
exec側 v4（Tier勾配/worktree並列/branch-mergeバリア/loop-until-done）の実走証明は、調査で判明した4 moat（exec.md veto 上書き・settings.json security・dormant 迂回・コスト計測機構欠落）を解消する gate 付き runbook として整え、**実走は次サイクル**へ送る。

> **スコープ確定（ユーザ判断・2026-06-09）**: 証明スコープ=**Structure-A（#12 依存線で切る）** / exec.md veto=**今は上書きしない（#12 保留）** / settings.json=**revert せず git 追跡状態にする**。

## 背景（なぜ / 要件 / 前提）

**なぜ**: v4 の並列/loop と investigate consensus 収束修正は code+prose では実装済みだが実走未検証（コスト懸念で保留してきた）。verify の side-effects 誤検知は exec の毎タスクで再発し adversarial verify の信頼性と Opus の手判定コストを損なう。誤検知ノイズを除いてからでないと実走証明が濁る。v4 が未証明のままなのが最大の残存リスク。ただし調査で **exec側のフル証明は今サイクルでは構造的に不可能**（後述）と判明したため、achievable な半分（fix + plan側）を確実に取りに行く。

**要件**:
1. **verify fix**: verifier が「渡された diffText のみ」を根拠に、task 由来でない pre-existing/未コミット差分を副作用判定しない。verdict schema（lens/matches/deviations/summary、集約 consensusMatch/matchVotes/highSeverity）後方互換・read-only 維持・exec.md の args 契約（taskId/targets/planExcerpt/diffText/codexSummary/cwd）を**壊さない**（= workflow.js のみ変更、exec.md 不変）。
2. **plan側 v4 実証明**: 実 goal で investigate の早期収束（high gap ゼロ→収束）と residual high gap の escalate が設計どおり動くことを観測・記録し、コスト（トークン）を観測する。
3. **fix dry-run**: pre-existing 差分が在る状態で side-effects 誤検知が消えることを複数回 dry-run で実証（非決定性の確認込み）。
4. **exec側証明の準備完了**: #12 マージ後にしか踏めない exec 並列/Tier/loop の証明を、前提解消チェックリスト付き runbook として次サイクル即実行可能にする。今サイクルでは**実走しない・exec.md に触れない**。

**前提（調査で確定したもの）**:
- 前提 ⚖️「sonnet verifier が Bash/git を実行できるか」=**YES 確定**（実機 journal wf_0fb922cf 等で3レンズ全部が agentType=workflow-subagent で git diff/log/show/--name-only を自走）。verifier は args に baseline が無いと独自 baseline（例 `feat/ui-ux-search..HEAD`）を**即興選択**し、`--name-only` で target 外を能動走査する=これが誤検知の機構。
- PR#11（現ブランチ・plan側）/ PR#12（exec側）はファイル重複ゼロ・両 OPEN/MERGEABLE/CLEAN・順不同マージ可。
- verify 対象 `goal-exec-verify.workflow.js` は両 PR に含まれず clean → **候補A（workflow.js のみ）は両PR完全非衝突で即着手可**。
- **grounding 訂正（critic H6/H29）**: findings 内で wf_1101cd5b の生ログ「不在」と「実在」が割れたが、実機で**実在**（16207 bytes, highSeverity:[]/low）。plan は実在側（side#5/6/7）を採る。settings.json HIGH 誤検知は **×3**（wf_9437973c/wf_3befc688/wf_4075af37）で、既存 fix plan の「×2」は実機3件で上書き。

## 調査結果（goal実態 / 現状実態 / ギャップ）

- **goal実態**: v4 の証明対象は **#12 依存線で二層に割れる**。plan側 v4（investigate 収束＝PR#11・現ブランチにコミット済み）と verify fix（workflow.js のみ）は**#12 なしで証明可能**。exec側 v4（Tier/並列/branch-merge/loop＝PR#12 の exec.md v4）は**#12 マージなしには一切発火しない**。
- **現状実態**: コスト計測機構が構造的に不在（workflows に token 計測ゼロ・codex `-o md` のみで `--json` 無し）。tier-policy.md は全 repo 不在＝#12 マージ後も**初回は全 Tier A＝並列が dormant**。settings.json に 6/3 起源（Claude の変更でない）の未コミット差分が常在し verify 誤検知の引き金。docs/plans は gitignore で fragile。
- **ギャップ（gold標準との差）**:
  - G1（verify fix）: side-effects レンズが「自前 git・独自 baseline・`--name-only` 走査」で pre-existing を拾う → **候補A（prompt lockdown）で封じる**。ただし H8: 直列パスで **target ファイル自身に混在する pre-existing 未コミット差分は diffText 内**のため候補A では構造的に塞げず、構造解は候補B（baseCommit）＝exec.md を要し #12 衝突＝**#12 後送り**。
  - G2（plan側証明）: 早期収束/residual escalate の**観測基準が未定義**（H1: 初回 critic 単独収束は rounds=[] になりうる）。終了経路が4つあり区別が要る（H2）。さらに **この investigate 自身が 12 high gaps で収束せず 3 round 全消費・1.27M tokens** → critic "high" rubric 過剰発火で**現実 goal では早期収束が踏めない**可能性（実データ）。
  - G3（exec側証明）: #12 マージ＝exec.md 編集 veto（feedback L14）の上書き／dormant 迂回（tier-policy 手置き＝H4 設計迂回）／コスト計測欠落（H27）／settings.json security（H9）の **4 moat を解かないと踏めない** → **今サイクルでは achievable でない**。

## 実行計画

- [ ] task-1: 前提検証ゲート（候補A の有効経路を実機で確定）
  - 操作対象: 最小 read-only workflow（一時 `.workflow.js`）＋ `goal-exec-verify.workflow.js` 既定フォールバック経路（L18/L79）
  - 操作内容: diffText に「自分で git せよ」の caller 注入を**含めない**既定状態で、sonnet verifier が (a) 自発的に `git diff`/`--name-only` を叩くか (b) Read だけで現在状態から pre-existing を拾うかを実機観測。過去 run（wf_9437973c 等）の diffText arg に git 自走指示が注入されていたかも確認。
  - 影響場所と効果: 候補A の文言を「git 禁止中心」か「Read 抑制中心」かに振り分ける根拠を grounding 付きで確定（critic H7/H12 を潰す）。read-only。
  - goалへの影響: fix 範囲を推測でなく実機根拠で確定。
  - 種別: **Opus/人間が `!` で実走・観測**（codex 実装ではない）

- [ ] task-2: verify fix 候補A（prompt lockdown）を workflow.js に実装
  - 操作対象: `workflows/goal-exec-verify.workflow.js`（side-effects focus L31-35 / agent prompt L73-79 / diffText フォールバック L18）
  - 操作内容: task-1 の結果に応じ次を追記 — (i) agent prompt に「`git diff`/`status`/`log`/`show`/`--name-only` の自前実行・独自 baseline 選択を禁止。渡された diffText のみを差分の唯一の根拠とせよ。diffText に無い変更を副作用判定するな」(ii) side-effects focus に「pre-existing/未コミット差分は副作用ではない」(iii) L18 フォールバックを「diffText が空でも対象ファイルと plan 設計の整合のみ見る・pre-existing 差分を副作用と見なすな」へ。**verdict schema・args 契約・read-only・exec.md は不変**。
  - 影響場所と効果: L1（自前 git）＋Read フォールバック経路の誤検知を封じる。両 PR 非衝突。
  - goалへの影響: 要件(1) を最小・両PR非衝突で満たす。**既知の残差（H8）を明記**: 直列パスで target ファイル自身に混在する pre-existing 未コミット差分は候補A では構造的に塞げない → 候補B（baseCommit）が構造解だが exec.md を要し #12 衝突＝**#12 マージ後の別タスク**（今サイクルは veto 保留で着手しない）。
  - 種別: **codex 実装（/goal:exec）**

- [ ] task-3: verify fix dry-run（before/after・複数回で安定性確認）
  - 操作対象: 制御された pre-existing 未コミット差分（使い捨て/無関係ファイル上に意図的に作る。settings.json は task-6 で追跡化するため母集団に使わない）＋ `goal-exec-verify` を手起動
  - 操作内容: fix 投入前後で、pre-existing 差分が在る状態の最小 verify を**複数回**回し、side-effects HIGH が before>0 → after=0 で**安定**するかを観測（critic H24 の非決定性: 同一差分が low/high で揺れた実績あり）。安定しなければ候補C（B 併用・#12後）必要の根拠として記録。
  - 影響場所と効果: 候補A の効力を実証明（要件(1)/(3) の検証）。read-only。
  - goалへの影響: fix が誤検知を実際に消すことの証跡。
  - 種別: **Opus/人間が `!` で実走・観測**

- [ ] task-4: plan側 v4 証明 — 早期収束（investigate）
  - 操作対象: `goal:plan` を blocking high gap ゼロになる極小 test goal で実走（現ブランチ PR#11 コード）
  - 操作内容: investigate の log/return で収束を観測。判定は **`consensusComplete=true` ＋ `roundNumber`/findings 数**で行う（初回 critic 単独収束は `rounds=[]` になりうる＝H1）。**この investigate 自身が 12 high gaps で収束しなかった実データ**を踏まえ、極小 goal でも critic high gap が 0 にならなければ critic "high" rubric が過剰発火＝早期収束が構造的に踏めない（→ dme/goal 改善の追加課題として surface）。token コストも観測（journal usage）。
  - 影響場所と効果: 早期収束の実証跡 or rubric 過剰発火の確証。
  - goалへの影響: 要件(2) の plan側半分（収束）＋コスト観測。
  - 種別: **Opus/人間が実走・観測**

- [ ] task-5: plan側 v4 証明 — residual escalate（investigate）
  - 操作対象: `goal:plan` を blocking gap が埋まりきらない test goal で実走
  - 操作内容: どの終了経路（stall / MAX_ROUNDS / budget backstop / madeProgress）で `unresolvedHighGaps` が残り plan の ⚖️ へ escalate されるかを**区別して**記録（H2）。budget backstop 経路は早期収束と紛れるため budget 設定を明示。
  - 影響場所と効果: residual escalate の実証跡。
  - goалへの影響: 要件(2) の plan側半分（escalate）。
  - 種別: **Opus/人間が実走・観測**

- [ ] task-6: settings.json を git 追跡状態にする（revert せず）
  - 操作対象: `settings.json`（未コミット差分）
  - 操作内容: ユーザ指示「revert しない・変更するなら git 追跡可能に」に従い、差分を**独立スコープのコミット**として追跡化（PR#11/#12 の scope に混ぜない）。差分は2種混在 — (1) allow += Read/Edit/Write・additionalDirectories += nestify 系（妥当）、(2) deny -= `git reset --hard`/`git branch -D`（破壊的 git の permission backstop 喪失）。**(2) を緩めたまま固定化するか、deny を復元しつつ (1) は追跡するかは security ⚖️＋起源確認（6/3・Claude の変更でない）を人間に返す hard-stop**。
  - 影響場所と効果: fragile な未コミット差分を解消（verify 誤検知の常在トリガも消える）。
  - goалへの影響: 実走環境の衛生＋security 前提の明示化。
  - 種別: **git commit（人間 gate＝起源確認後）**

- [ ] task-7: exec側 v4 証明 runbook ＋ 前提解消チェックリスト（次サイクル用）
  - 操作対象: `docs/`（runbook md。gitignore 配下のため追跡 or リポ外退避を併記）
  - 操作内容: #12 マージ後にしか踏めない exec 並列/Tier勾配/branch-mergeバリア/loop-until-done の証明手順と前提解消を実走チェックリスト化: (i) exec.md veto の上書き承認（H10）, (ii) dormant 回避＝tier-policy.md 手置き（H4 迂回を受容するか）or Tier B/C 自然成立の独立バッチ低リスク goal 選定（H11）, (iii) コスト計測機構の新設（codex `--json` or session jsonl usage 一次ソース化／H27）, (iv) plan.md 退避（gitignore で fragile・exec 自走の rm/reset と同居／H25）, (v) PR 作成=外向き hard-stop（H3）, (vi) loop-until-done は意図的差し戻し誘発が要る（H5）, (vii) test-goal repo 選定（~/.claude=node --check で Tier 勾配薄／nestify-ide=build/test あるが security 波及／H26）。
  - 影響場所と効果: exec側証明を「人間 gate 付きで次サイクル即実行可能」に。
  - goалへの影響: 要件(4)。今サイクルの achievable 範囲を超えない。
  - 種別: **doc 作成（codex or Opus）**

## 未確定・要判断事項

確定済み（ユーザ判断 2026-06-09）: ①証明スコープ=Structure-A / ②exec.md veto=上書きしない・#12保留 / ③settings.json=revert せず追跡化。以下は plan 内に残る ⚖️:

- ⚖️ **settings.json の deny 緩和（task-6 hard-stop）**: 追跡化は確定だが、deny からの `git reset --hard`/`git branch -D` 削除（破壊的 git の permission backstop 喪失）を**そのまま固定化するか、deny を復元しつつ allow/additionalDirectories の追加だけ追跡するか**。起源（6/3・誰が何のため緩めたか・Claude の変更でない・git/reflog に痕跡なし）は Claude には追えず**人間確認**。
- ⚖️ **候補A の H8 残差（fix 範囲）**: 直列パスで target ファイル自身の pre-existing 差分は候補A では塞げない。今サイクルは A の限界を受容し、構造解の候補B（baseCommit）は **#12 マージ後**に別タスクで着手するか。task-3 dry-run で HIGH=0 が**安定しなければ**候補C（B 併用）の前倒し要否を再判断。
- ⚖️ **critic "high" rubric の過剰発火（dme/goal 改善の中核・task-4 で顕在化）**: この investigate が 12 high gaps で収束しなかった = 現実 goal では早期収束が踏めず、毎回 residual escalate＋高コスト（1.27M tokens）になる。task-4 で極小 goal でも 0 にならなければ、**critic の high 判定基準を絞る改善**（plan を誤らせる/危険にするものだけ high）を別タスク/別サイクルで行うか。これは「dme/goal コマンド改善」の実データ起点。
- ⚖️ **exec側証明の次サイクル前提（runbook 内・今 surface）**: 並列を tier-policy.md 手置きで**迂回**して出すのを「設計どおりの証明」と認めるか（H4）、それとも Tier B/C が**自然成立**する独立バッチ低リスク goal を選んで dormant-until-evidence を尊重するか（H11）。
- ⚖️ **plan.md 自体の fragility**: 本 plan.md（および runbook）は gitignore `plans/` 配下で git 未追跡＝消失リスク。今サイクルの run は read-only 中心で破壊的操作と同居しないが、追跡 or リポ外退避を行うか（軽め）。

## PR仕様（PR / スコープごと。/goal:exec はこの仕様どおりに PR 本文を書く）

- **PR-1**: `~/.claude` — verify fix（候補A・prompt lockdown）
  - 目的: verifier が pre-existing/未コミット差分を副作用と誤検知しないよう、prompt を「自前 git 禁止・diffText のみ根拠」に限定する（L1＋Read フォールバック経路を封じる）。
  - 満たすべき要件: verdict schema 後方互換 / read-only 維持 / exec.md・args 契約は無変更（PR#11/#12 非衝突）/ 候補A の H8 残差（直列 target自身 pre-existing）は本PRの対象外と明記。
  - 着手前 / 完了後: verifier が自前 git で独自 baseline を立て target 外を `--name-only` 走査し pre-existing を HIGH 誤検知 → diffText のみ根拠で誤検知抑止（複数回 dry-run で HIGH=0 安定）。
  - 作業フロー図（mermaid）:
    ```mermaid
    flowchart TD
      A[task-1: 前提検証ゲート 実機で git/Read 経路を確定] --> B[task-2: 候補A を workflow.js に実装]
      B --> C[node --check workflows/goal-exec-verify.workflow.js]
      C --> D[task-3: pre-existing差分が在る状態で最小verify を複数回dry-run]
      D --> E{side-effects HIGH=0 が安定?}
      E -->|安定| F[完了: 誤検知解消を実証]
      E -->|揺れる| G[⚖️ 候補C/B を #12後に検討 と記録]
    ```
  - 解決タスクと goал への効果: task-1（経路確定）, task-2（fix 本体）, task-3（効力実証）→ 要件(1)/(3)。
  - PR外への影響: exec.md・args 不変のため PR#11/#12 と非衝突。並列 verify（#12後）にも同じ workflow が効く。
  - Verification: `node --check workflows/goal-exec-verify.workflow.js` ＋ task-3 の「pre-existing 差分が在る状態での最小 verify を複数回 dry-run → side-effects HIGH=0 が安定」。初回は exec 権限外のため Claude 照合＋人間の `!` 実行。
  - その他共有事項: 候補B（baseCommit baseline）は exec.md を要し #12 と衝突するため**今サイクル非対象**。dry-run で非決定性が残れば #12 後に B 併用（候補C）を再判断。

- **PR-2**: `~/.claude` — settings.json を git 追跡状態にする（task-6）
  - 目的: 6/3 起源の未コミット差分を fragile なまま放置せず、git 追跡状態にする（verify 誤検知の常在トリガも解消）。
  - 満たすべき要件: revert しない（ユーザ指示）/ PR#11・#12 の scope に混ぜず独立コミット / deny 緩和の security 含意と起源を本文に明示。
  - 着手前 / 完了後: 未コミット差分が常在し verify 誤検知の引き金＋fragile → 追跡化し衛生確保。
  - 作業フロー図（mermaid）:
    ```mermaid
    flowchart TD
      A[起源確認 6/3 誰が何のため deny緩和したか 人間hard-stop] --> B{deny緩和を固定化? or 復元?}
      B -->|固定化| C[現差分をそのまま追跡コミット]
      B -->|復元| D[deny復元+allow/additionalDirsのみ追跡コミット]
      C --> E[JSON妥当性確認]
      D --> E
    ```
  - 解決タスクと goал への効果: task-6 → 実走環境の衛生＋security 前提の明示化。
  - PR外への影響: permission 設定の変更は ~/.claude 全 session に影響。deny 固定化を選ぶと破壊的 git の permission backstop 喪失が恒久化（exec側 v4 自走と相互作用）→ 本文に明記。
  - Verification: JSON 妥当性（`node -e "JSON.parse(require('fs').readFileSync('settings.json','utf8'))"`）。security 判断と起源確認は人間 gate。
  - その他共有事項: **task-6 は起源確認の hard-stop を通すまで commit しない**。

- **スコープ-3**（PR 無し・検証活動）: plan側 v4 実証明（task-4 / task-5）
  - 目的: 現ブランチ（PR#11）の investigate を実 goal で回し、早期収束と residual escalate を実証明＋コスト観測。
  - 満たすべき要件: read-only / コード変更なし / 観測基準（consensusComplete + roundNumber + 終了経路）を明示記録。
  - 着手前 / 完了後: v4 plan側が実走未証明 → 早期収束・escalate・コストの実証跡を取得（or rubric 過剰発火を確証）。
  - 作業フロー図（mermaid）:
    ```mermaid
    flowchart TD
      A[task-4: 極小goalでgoal:plan実走] --> B{critic high gap=0で収束?}
      B -->|Yes| C[早期収束を実証 consensusComplete=true]
      B -->|No| D[⚖️ rubric過剰発火を記録 dme/goal改善へ]
      E[task-5: 埋まらぬblocking gap goalで実走] --> F[どの終了経路でresidual escalateか記録]
      C --> G[token コスト観測 journal usage]
      D --> G
      F --> G
    ```
  - 解決タスクと goал への効果: task-4/5 → 要件(2)。
  - PR外への影響: なし（read-only 実走。token コストのみ発生）。
  - Verification: なし（手レビュー＝実走ログ/journal の観測。コード変更が無いため build/test 対象外）。
  - その他共有事項: task-4 と task-5 は別 test goal（1 goal で早期収束と residual escalate は両立困難＝H28）。

- **PR/スコープ-4**: `~/.claude` — exec側証明 runbook（task-7）
  - 目的: #12 マージ後にしか踏めない exec 並列/Tier/loop の証明を、前提解消チェックリスト付きで次サイクル即実行可能にする。
  - 満たすべき要件: doc のみ / 4 moat（veto・security・dormant迂回・コスト計測）と H3/H5/H25/H26 を実走チェックリストに含める / 今サイクルでは exec.md に触れない。
  - 着手前 / 完了後: exec側証明が「何を解けば踏めるか」未整理 → gate 付き runbook で次サイクル即実行可能。
  - 作業フロー図（mermaid）:
    ```mermaid
    flowchart TD
      A[task-7: runbook起草] --> B[前提解消チェックリスト: veto/security/dormant/cost/plan保全/PR hard-stop/差し戻し誘発/repo選定]
      B --> C[次サイクルの実走手順を順序付け]
    ```
  - 解決タスクと goал への効果: task-7 → 要件(4)。
  - PR外への影響: なし（doc）。
  - Verification: なし（手レビュー）。doc のため build/test 対象外。
  - その他共有事項: runbook は gitignore 配下のため追跡 or リポ外退避を併記。

---

## 実行順序（依存）

```
task-1（前提検証ゲート）→ task-2（候補A実装）→ task-3（dry-run検証）   ← PR-1
task-6（settings.json 追跡化・起源確認 hard-stop 後）                   ← PR-2（独立・早めに環境衛生）
task-4 / task-5（plan側証明・read-only・独立）                          ← スコープ-3
task-7（runbook・doc・最後）                                            ← PR/スコープ-4
```
