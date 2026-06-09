# Goal: タスク設計＋実行状態のライブ可視化（goalflow 外付けスキル taskflow-live-visualizer）

> 開発フローは グローバル `~/.claude/CLAUDE.md` と `/goal:plan`・`/goal:exec(-v4)` を正本とする。本 plan は承認後 `/goal:exec`（または `/loop /goal:exec-v4`）の唯一の真実となる。記載外の実装・リファクタ・追加調査・仕様変更は行わない。

AI が毎回生成するタスク設計（プラン）を DAG として描き、実行中に「今どのタスクを処理しているか／それが全体のどこか」を一目で把握できるライブ可視化を、goal:plan / goal:exec(-v4) に **外付けする別スキル** として作る。中核ロジックは外付けスキル（`skills/goalflow-viz/`）に置き、不変コア（特に `commands/goal/exec.md` v3）は一切編集しない。レンダラは一度だけ作って固定資産化し、毎回 AI が生成するのは構造データ（tasks.json）のみ。

---

## 背景（なぜ / 要件 / 前提）

### なぜ
- 大規模 AI 開発はドキュメント管理だと全体構造を見失う。欲しいのは「整ったドキュメント」ではなく **「プラン＋実行状態の射影」**。
- goalflow v4 は `/loop` で exec-v4 を長時間・無人で自走させるため、「今どのタスク・全体のどこ」を **ambient** に把握できる価値が他用途より高い。
- 着想元は条件付き確率生成パイプラインのライブ可視化。ただし対象は「ドメインシステム」ではなく「タスク設計そのもの＋実行の現在地」。

### 要件
1. 毎回の run で AI 生成のタスク DAG をレンダリングできる。
2. 実行中、現在タスクをリアルタイムに点灯（現在地）。v1 は **L1 + file-watch 自動リフレッシュ**（ユーザ確定）。L3 ストリームは将来 ramp。
3. 「今のタスクが全体のどこか」を一目で。
4. read-only / 非侵襲。exec の挙動・コスト・性能に実質的オーバーヘッドを与えない。
5. 既存 seam を再利用（codex-exec-guard hook 流儀 / exec-v4 workflow journal / git）。
6. run 間でレイアウトが安定する決定論的配置。
7. ノード状態 done/current/next/blocked/failed の色分け、連続ズーム＋ミニマップ＋階層グレイン（俯瞰＝タスク DAG / ズームイン＝codex→commit→verify サブステップ）。
8. worktree 並列バッチ（レーン）と branch-merge バリアの可視化（v1 は lane=null 直列固定、並列実証後に有効化）。

### 確定済み設計判断（前提・再検討しない）
- **(A)** タスクグラフ＝第一級の構造化データ（安定 ID 付き）。散文から都度推測しない。
- **(B)** 外付けスキルとして実装・コア不変。協力は exec-v4（編集可）に置く。plan は **追加出力のみ**（tasks.json 併記）。`exec.md`(v3) は編集却下済み。
- **(C)** 最小協力（M案）: コアに頼むのは「安定タスク ID が plan 出力と codex 呼び出しを貫通すること」だけ。それ以外は 0-touch の外付け。
- **(D)** サイトは作り直さない／データだけ毎回生成。レンダラは固定資産化、腐敗するのはデータ側だけ。
- **(E)** 進捗イベントは 3 観測 seam を融合して得る（コア無編集）: ①hook（codex 開始）/ ②git（per-task commit）/ ③verify workflow journal（verdict）。
- **(F)** 実行中は DAG 凍結（plan-exec 契約: plan 変更は停止→再承認）。可視化は固定レイアウト＋状態オーバーレイで済む。
- **(G)** UX: 連続ズーム＋ミニマップ、階層グレイン、ノード状態色分け。

### ユーザ確定の設計分岐（本 plan で確定済み）
- **実装形式** = 外付けスキル `skills/goalflow-viz/`（本体）＋ `/goal:viz`（goal コマンドの caller）。
- **レンダラ技術** = **dagre-d3（CDN）**: Sugiyama 決定論レイアウト＋d3-zoom 連続ズーム/ミニマップ＋状態色分け。
- **liveness** = **L1 + file-watch 自動リフレッシュ**（PostToolUse/ledger 不要）。

### 前提・制約
- permission ポリシー v4: worktree 全許可 / git 履歴改変（reset --hard・branch -D・force push・rebase・commit --amend）は一律禁止 / **main 統合は必ず PR 経由**。
- 追加が許されるのは: 別スキル本体（skills/goalflow-viz/）・settings.json への hook 追記（L3 ramp 時のみ）・CLAUDE.md へのポインタ追記・plan の追加出力（tasks.json）・exec-v4 controller の編集。**編集禁止: `commands/goal/exec.md`(v3)**。
- 依存: 本機能は exec-v4 が main 上の現行 controller であることを前提（PR#15 で MERGED 済み・memory の「未マージ」記述は誤りと実機訂正）。worktree 並列（§6）・ledger（§8）は未実証/未実装ゆえ v1 の event source にしない。

---

## 調査結果（goal実態 / 現状実態 / ギャップ）

### goal 実態（可視化が乗る seam・実ファイル確認済み）
- **exec-v4.md（編集可）** は既に task-id を codex 呼び出し `-o .codex-out/<task-id>.md`・branch `goalflow/<run-id>/<task-id>`・per-task commit・baseCommit・verify args に貫通させている（§3-§8）。`-o` の <task-id> は plan 散文の task-N を Opus が割り当てる（実証: `.codex-out/task-1.md`〜`task-9.md` 実在）。
- **verify journal `wf_*.json`**: `args.taskId`/`result.taskId` が全 15 件で一致・存在（task-1..9, task-A1/B1/C4, consensus-fix-task-1, task-2-hook-gtimeout）。`result.consensusMatch` で done/fail 判定、`totalTokens` 記録あり。**top-level `taskId` は workflow 内部 ID で使えない**（fusion は `result.taskId`/`args.taskId` を使う）。
- **codex-exec-guard.sh** は PreToolUse hook（Bash matcher）。`-o .codex-out/<task-id>.md` から task-id 抽出可。**PostToolUse hook は未登録**（＝codex「終了」の hook 観測点なし）。
- **レンダラ先行パターン**: `session-report/template.html` の `<script id='report-data' type='application/json'>{}</script>` inline JSON injection ＋ skill-creator の `open <html>`。DAG ライブラリはシステム内に無し → CDN（dagre-d3）採用。
- **出力先**: `docs/plans/<slug>.tasks.json` は **git 追跡される**（`docs/` に nested `.gitignore` なし・`git check-ignore` で確認）。`.goalflow/`・`.codex-out/` は ignore。

### 現状実態（未整備）
- plan.md 出力は `- [ ] task-N`＋4項目散文（52-80 行）のみ。**tasks.json / edge / tier / target の構造データはゼロ**。
- exec-v4 は `@$ARGUMENTS`（plan.md）のみ読む。**tasks.json を読む step は無い**。
- **ledger（`.goalflow/state/<run-id>.json`）は exec-v4.md §8 の prose 規定のみで未実装**（`.goalflow/` 実体ゼロ）→ v1 の event source にしない。
- **worktree 並列（§6）は未実証**（spike ブランチ＝手動直列ダミーコミット 1 秒差）→ v1 は lane=null 直列固定。
- **run-id 決定論生成規約なし**（spike は手動命名）。`.codex-out/` は run-id 名前空間なしで 28 ファイルが共存（複数 run が同名上書き）。

### ギャップ（goal 到達に埋めるべき差分＝本 plan の実行計画）
1. **tasks.json＋graph-data の公開スキーマが無い**（最初に固めるべき公開 API）。→ task-1。
2. **plan.md が tasks.json を出力しない**。→ task-2（追加出力のみ）。
3. **exec-v4 が tasks.json の id を canonical に使わない**（散文 task-id 割り当てに drift リスク: 実例 `task-2-hook-gtimeout`）。→ task-3（M案 最小協力・1-2 行）。
4. **renderer.html（固定資産）が無い**。→ task-4（dagre-d3）。
5. **3 seam を id で融合し状態オーバーレイを作る層が無い**。→ task-5（fusion skill＋`/goal:viz`）。
6. **ライブ更新機構が無い**。→ task-6（file-watch）。
7. **発見可能性（CLAUDE.md ポインタ）が無い**。→ task-7。

> **critic の取り扱い**: 調査 critic は high gap を 14 件（重複排除で 5 件）escalate したが、うち 4 件（tasks.json スキーマ未記載 / exec-v4 未 Read / run-id 未追記 / renderer+viz 未作成）は **「成果物が未実装」＝本 plan が定義する作業そのもの** であり、理解の抜け（blocking gap）ではない（既知の consensus 偽陽性モード）。残り 1 件（.codex-out run-id 名前空間）のみ真の設計分岐で、下記「未確定」に整理した。

---

## 実行計画

### PR-1: 契約レイヤー（schema ＋ emit cooperation）

- [ ] **task-1: tasks.json ＋ graph-data スキーマ定義（公開 API）**
  - 操作対象: 新規 `docs/viz/SCHEMA.md`
  - 操作内容: 2 スキーマを確定する。**tasks.json**（plan emit・静的 DAG）: `{ "planSlug": string, "generatedAt": string, "tasks": [{ "id": string, "label": string, "tier": "A"|"B"|"C", "targets": string[], "deps": string[], "lane": null|number }], "edges": [{ "from": string, "to": string }] }`（edges は deps から導出・冗長保持）。**graph-data**（renderer 入力 = tasks.json ＋ status overlay）: 各 task に `"status": "pending"|"running"|"committed"|"verified"|"failed"` を付与。**id 規約**: plan.md 散文の task-N と一致する安定 ID＝exec-v4 が `-o`/branch/verify に貫通させる canonical id。renderer は status と deps から表示上の done/current/next/blocked/failed を導出する旨も明記。
  - 影響場所と効果: 以降の全成果物（plan emit / exec-v4 / fusion / renderer）がこの 1 ファイルにぶら下がり、公開 API が固定される。
  - goalへの影響: 前提(A)「第一級構造化データ」と (C)「安定 ID 貫通」の契約面。最初に固めるべき公開 API を確定。

- [ ] **task-2: plan.md に tasks.json 追加出力を追記**
  - 操作対象: `commands/goal/plan.md`（出力セクション・78 行直後）
  - 操作内容: 「## tasks.json 追加出力」サブセクションを追加し、実行計画のタスク群を SCHEMA.md 準拠で `docs/plans/$ARGUMENTS.tasks.json` に Write する指示を書く。id は散文 task-N と一致、deps は PR/スコープ設計から導出、tier は exec-v4 §5 の判定、lane は v1 では null。**後方互換: `.md` 出力は不変（追加出力のみ＝前提 B）**。
  - 影響場所と効果: 毎 plan run で機械可読な DAG が生成される。`.md` は従来通り。
  - goalへの影響: 要件 1「毎回の run で AI 生成タスク DAG をレンダリング」のデータ源。

- [ ] **task-3: exec-v4.md に tasks.json 読込＋canonical id 規約を追記（M案 最小協力）**
  - 操作対象: `commands/goal/exec-v4.md`（§1 直後）
  - 操作内容: 「`docs/plans/<slug>.tasks.json`（slug = $ARGUMENTS の `.md` を `.tasks.json` に置換）が存在すれば Read し、その `id` を当該タスクの canonical task-id として `-o .codex-out/<id>.md`・branch・verify args に使う。不在時は従来通り散文から導出（後方互換）」を数行で追記。`Read` は allowed-tools 既存（line 5）。**`exec.md`(v3) は不可触。run-id 生成は v1 では追記しない**（未確定 ⚖️-A へ）。
  - 影響場所と効果: tasks.json の id が codex/git/verify の 3 seam に確実に一致し、fusion が id で正しく突合できる（散文 drift を排除）。
  - goalへの影響: 前提(C) 安定 ID 貫通の実体化。fusion 突合の健全性を保証。

### PR-2: 外付け可視化スキル（fusion ＋ renderer 固定資産 ＋ watch）

- [ ] **task-4: renderer.html 固定資産を作成（dagre-d3）**
  - 操作対象: 新規 `skills/goalflow-viz/renderer.html`
  - 操作内容: self-contained HTML。`<script id="graph-data" type="application/json">{}</script>` に graph-data を inline 注入（session-report 先行パターン）。**dagre ＋ d3 を CDN 読込（SRI 付与）**、dagre の topological＋Sugiyama で **決定論レイアウト**、**d3-zoom で連続ズーム＋ミニマップ矩形**、node 色 = status（pending=灰/running=青/committed=黄/verified=緑/failed=赤）、deps 未充足の pending は blocked（暗灰）として導出。階層グレイン（俯瞰＝タスク DAG / ノード展開で codex→commit→verify サブステップ）。lane=null は単一縦フロー、lane=int は横レーン（v1 は全 null）。**一度だけ作る固定資産**。
  - 影響場所と効果: graph-data を渡せば DAG が描ける描画資産が確定する。
  - goalへの影響: 要件 3,6,7「全体のどこか一目」「決定論レイアウト」「状態色分け・ズーム＋ミニマップ」。

- [ ] **task-5: fusion ＋ `/goal:viz` スキル＆コマンドを作成**
  - 操作対象: 新規 `skills/goalflow-viz/SKILL.md`（fusion 本体）＋ `commands/goal/viz.md`（`/goal:viz` caller）
  - 操作内容: **SKILL.md** = tasks.json を読み、3 seam を **run-window（mtime ≥ `docs/plans/<slug>.tasks.json` の mtime）でスコープ** して融合する: (1) `.codex-out/<id>.md` 存在＝running/done、(2) `git log` で当該 task の per-task commit＝committed、(3) `find … -name 'wf_*.json'` → `workflowName=goal-exec-verify` ∧ `args.taskId/result.taskId` 一致 → `result.consensusMatch` で verified/failed。各 id に status を付与して graph-data を生成し、`renderer.html` をコピーして `<script id="graph-data">` を Edit 注入、`open` でブラウザ表示。read-only/非侵襲（exec に触れない）。**commands/goal/viz.md** = `/goal:viz <slug>` で `Skill(goalflow-viz)` を呼ぶ薄い caller（`argument-hint: docs/plans/<goal-slug>.md`、allowed-tools に Read/Glob/Write/Edit/Bash(find:*)/Bash(git log:*)/Bash(open:*) を明示）。
  - 影響場所と効果: 3 seam → タスク ID 付き状態オーバーレイ → DAG 点灯。`.codex-out` は last-run-wins だが mtime スコープで現 run のみ反映。
  - goalへの影響: なぜ/要件 2,3「プラン＋実行状態の射影」「現在地点灯」の中核。

- [ ] **task-6: file-watch 自動リフレッシュモード**
  - 操作対象: `skills/goalflow-viz/`（小 watcher: `watch.sh` 等）＋ `commands/goal/viz.md` に `--watch`
  - 操作内容: `.codex-out/` と verify journal ディレクトリの変化を watch（`fswatch` 不在時はポーリング）し、変化時に fusion 再実行＋graph-data 再注入＋ブラウザ自動リロード（meta refresh か軽量リロード）。PostToolUse/ledger 不要（L1+watch）。`/loop` 自走中に ambient 更新。**watcher は read-only・exec に触れない**。
  - 影響場所と効果: 手動再実行なしに現在地がほぼライブ更新。
  - goalへの影響: 要件 2「リアルタイムに点灯」を L1+watch で近似（ユーザ確定の v1 ramp）。

- [ ] **task-7: CLAUDE.md にポインタ追記**
  - 操作対象: `~/.claude/CLAUDE.md`（## コマンド 節）
  - 操作内容: `/goal:viz` と `skills/goalflow-viz/` の存在・用途・tasks.json 公開 API（`docs/viz/SCHEMA.md`）へのポインタを追記。**フロー本体は再定義しない**（ポインタのみ）。
  - 影響場所と効果: 可視化の発見可能性・運用定着。
  - goalへの影響: 機能が使われる状態にする。

---

## 未確定・要判断事項

> 高 stakes の 3 分岐（実装形式 / レンダラ技術 / liveness）は plan 確定前に `AskUserQuestion` で確認済み（本文「ユーザ確定の設計分岐」に反映）。以下は中 stakes 以下の ⚖️ と将来 ramp。`/goal:exec` 中にこれらが goal/要件に効くと判明したら停止して選択肢を返す。

- **⚖️-A（run-id 決定論生成を exec-v4 に入れるか）**: v1 は fusion を **mtime スコープ** で回すため run-id 不要と判断し**未追記**（M案 最小協力の維持）。並列レーン（§6）or run 横断履歴が要る時点で `run_id=$(date +%Y%m%d)-$(git rev-parse --short HEAD)` を exec-v4 §6/§8 に追記し、branch/ledger/`tasks.json.runId` を一貫させる。trade: 追加すると cross-run 集約・並列レーンが可能だが exec-v4 タッチが増える。
- **⚖️-B（.codex-out run-id 名前空間）**: v1 = **last-run-wins ＋ fusion mtime スコープ**（champion 採用）。同一 plan を再 exec して旧 task-id 残骸を誤検知するエッジは mtime で回避。完全硬化が要るなら v-next で exec-v4 の `-o` を `.codex-out/<run-id>/<task-id>.md` に変更（A 案・run-id 前提）。
- **⚖️-C（L3 ストリーム ramp）**: v1 = L1+watch。真のリアルタイム点灯／codex exit code 観測が要るなら **PostToolUse hook を settings.json に追加**（許可範囲）して `.goalflow/<run-id>/events.jsonl` に task-id+exit を追記する別 PR を起こす。worktree 並列レーン点灯も L3＋run-id とセット。
- **⚖️-D（CDN 依存）**: dagre-d3 採用＝オフライン不可・将来の CDN 腐敗リスク。v1 は **CDN＋SRI ハッシュ**で開始し、renderer の完了条件に「CDN 到達環境でブラウザが DAG を表示する」を明記。オフライン要件が出たら CDN 資産を `skills/goalflow-viz/vendor/` に vendoring、または pure-SVG zero-CDN へ。
- **⚖️-E（worktree 並列レーン可視化）**: exec-v4 §6 並列が未実証ゆえ v1 は **lane=null 直列固定**。dogfood で並列が実証されてから tasks.json の lane=int を有効化（renderer は lane を見て横レーン表示に切替・設計済み）。
- **⚖️-F（verify journal の runId 非対応）**: `goal-exec-verify.workflow.js` は runId 引数を持たない。v1 は「1 plan = 1 run」前提＋mtime スコープで回避。同一 plan の多重 run 混在は未対応（v-next で workflow に runId を渡す拡張）。
- **前提リスク（goalflow-v4 open threads）**: exec-v4 の worktree 並列・ledger は未実証/未実装。可視化はこれらに依存しない設計（v1 の 3 seam は `.codex-out` 存在・git commit・verify journal のみ）にしてある。verify baseline 誤検知（別 open thread）は本機能の status 判定に直接は効かない（fusion は `consensusMatch` を見るだけ）が、誤検知が多発する run では verified/failed の色が信頼できない点を運用上認識する。

---

## PR仕様（PR / スコープごと。/goal:exec はこの仕様どおりに PR 本文を書く）

- **PR-1: 契約レイヤー（schema ＋ emit cooperation）** — 対象リポジトリ: `~/.claude`（goalflow システム本体）
  - 目的: 可視化の公開 API（tasks.json＋graph-data スキーマ）を固定し、plan が tasks.json を追加出力し、exec-v4 がその安定 id を canonical に貫通させる。**安定 ID 貫通（M案）の契約面を確立する**。
  - 満たすべき要件: 要件 1,4,5、前提 A/B/C。後方互換必須（tasks.json は任意・plan の `.md` 出力不変・exec-v4 は tasks.json 不在時に従来散文へ fallback）。`exec.md`(v3) 不可触。
  - 着手前の立ち位置 / 完了後の立ち位置: 着手前＝plan は散文のみ・exec-v4 は task-id を散文から都度割り当て（drift リスク）・機械可読 DAG なし。完了後＝`docs/viz/SCHEMA.md` で公開 API 確定・毎 plan run で `docs/plans/<slug>.tasks.json` 生成・exec-v4 が tasks.json の id を `-o`/branch/verify に貫通。
  - 作業フロー図（mermaid）:
    ```mermaid
    flowchart TD
      A[着手前: 散文 plan のみ・id drift リスク] --> B[task-1: docs/viz/SCHEMA.md で tasks.json+graph-data 公開API確定]
      B --> C[task-2: plan.md に tasks.json 追加出力を追記・.md 出力は不変]
      C --> D[task-3: exec-v4 §1 直後に tasks.json Read + canonical id 規約を追記]
      D --> E[完了後: 安定 id が plan→codex→git→verify を貫通する契約成立]
    ```
  - 解決タスクと goal への効果: task-1/2/3。タスクグラフを第一級データ化し、3 seam を id で突合できる土台を作る（可視化の前提全て）。
  - PR外への影響: plan.md と exec-v4 は全 goalflow goal に影響するが、tasks.json は任意・後方互換のため既存挙動は不変（新規に tasks.json が毎 plan で生成されるのみ）。`exec.md`(v3) 不変。
  - Verification: 本 repo に共通 build/test は無い → **手レビュー＋スモーク**。(1) `docs/viz/SCHEMA.md` が tasks.json/graph-data の両スキーマと id 規約を定義していること。(2) 実 plan を `/goal:plan` で 1 本生成し `jq . docs/plans/<slug>.tasks.json` が SCHEMA 準拠で valid。(3) exec-v4 の 1 タスクで `-o .codex-out/<id>.md` の id が tasks.json の id と一致することを dry に確認。(4) tasks.json を消した状態で exec-v4 が従来通り散文 fallback すること。
  - その他共有事項: id 命名は plan の `- [ ] task-N` と完全一致を強制。run-id は本 PR では導入しない（⚖️-A）。

- **PR-2: 外付け可視化スキル（fusion ＋ renderer 固定資産 ＋ watch）** — 対象リポジトリ: `~/.claude`
  - 目的: 3 seam を融合して状態オーバーレイを作り、dagre-d3 の固定資産レンダラで DAG を描画、`/goal:viz` で起動、file-watch でライブ更新する。**プラン＋実行状態の射影を提供する**。
  - 満たすべき要件: 要件 1,2,3,4,6,7、なぜ全項。read-only/非侵襲（exec の挙動・コスト・性能に影響なし）。L1+watch（ユーザ確定）。
  - 着手前の立ち位置 / 完了後の立ち位置: 着手前＝tasks.json はあるが描画/融合手段なし。完了後＝`/goal:viz <slug>` で現在地点灯の DAG がブラウザ表示、`--watch` で /loop 自走中に ambient 自動更新。
  - 作業フロー図（mermaid）:
    ```mermaid
    flowchart TD
      A[着手前: tasks.json はあるが可視化手段なし] --> B[task-4: skills/goalflow-viz/renderer.html を dagre-d3 で作成・固定資産]
      B --> C[task-5: SKILL.md fusion 3 seam mtime スコープ + commands/goal/viz.md caller]
      C --> D[task-6: file-watch 自動リフレッシュ --watch]
      D --> E[task-7: CLAUDE.md にポインタ追記]
      E --> F[完了後: /goal:viz で現在地点灯 DAG・watch でライブ更新]
    ```
  - 解決タスクと goal への効果: task-4/5/6/7。「今どのタスク・全体のどこ」を ambient に可視化し、goal を完成させる。
  - PR外への影響: なし（0-touch 外付け。CLAUDE.md はポインタ追記のみ・フロー本体不変）。exec の挙動・コスト・性能に影響なし（全 read-only）。
  - Verification: 共通 build/test 無し → **手レビュー＋目視**。(1) `renderer.html` をサンプル graph-data で `open` → DAG がズーム/ミニマップ/状態色で描画される。(2) 実 `.codex-out/`・verify journal に対し `/goal:viz <slug>` 実行で各 task の status が正しく点灯（running/verified/failed）。(3) `jq` で生成 graph-data が SCHEMA 準拠。(4) `--watch` 起動中に `.codex-out/` を 1 ファイル更新 → ブラウザが自動リフレッシュ。(5) 旧 run 残骸（mtime 古い `.codex-out`）が現 run の完了として誤点灯しないこと。
  - その他共有事項: dagre-d3 は CDN＋SRI（⚖️-D）。lane は v1 全 null（⚖️-E）。L3 は将来 ramp（⚖️-C）。PR-1 マージ後に着手（schema 依存）。

---

plan.md を確認・編集のうえ `/goal:exec docs/plans/taskflow-live-visualizer.md`（または `/loop /goal:exec-v4 docs/plans/taskflow-live-visualizer.md`）を実行してください。
