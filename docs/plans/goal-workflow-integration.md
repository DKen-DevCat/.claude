# Goal: `/goal:plan`・`/goal:exec` に Claude Code の `Workflow`（マルチエージェント・オーケストレーション）を統合し、調査網羅性と検証精度を上げる

> slug: `goal-workflow-integration` ／ 実行は `/goal:exec ~/.claude/docs/plans/goal-workflow-integration.md`（`~/.claude` を作業ルートとして想定）。

## 背景（なぜ / 要件 / 前提）

- **なぜ:** 現行 `/goal` は「計画＝Opus、実行＝codex、検証＝Opus」の役割分離は確立済みだが、**調査も検証も単一エージェントの逐次処理に縮退しがち**。Claude Code の `Workflow` エンジン（決定論的JSで多エージェントを並列fan-out／構造化出力／逆検証）を組み込めば、**計画の網羅性・再現性**と**実行結果検証の精度**を底上げできる（＝精度向上）。
- **要件:**
  1. 既存の `/goal:plan`・`/goal:exec` に Workflow を**統合**する（別物の新運用ではなく既存の強化）。
  2. `/goal` の核（計画/実行のハードストップ分離、executor=codex≠verifier=Claude、1task=1codex、per-task gate、中断条件）は**壊さない**。
  3. 「計画・判断は Claude」を維持＝**Workflow はデータ（調査結果・検証verdict）を返すのみ**、plan.md の作文と最終判定は Opus が握る。
- **前提（確定事項）:**
  - `Workflow` は**背景・非対話**実行（task ID即時返却→完了通知で再開）。プリミティブ: `agent(prompt,{label,phase,schema,model,agentType,isolation})` / `parallel`(barrier) / `pipeline`(no-barrier,既定推奨) / `log` / `phase` / `budget` / `workflow()`(1段ネスト)。schema指定で構造化出力を強制・検証・自動リトライ。並列上限 min(16,cores-2)、総数上限1000。plain JS（TS不可・Date/Random不可・FS不可）。
  - **slashコマンドの指示で Workflow を呼ぶのは正当なopt-inトリガ** → コマンドに組み込めば自動でopt-in成立。
  - 参照方式: `name`（`.claude/workflows/`解決）/ `scriptPath`（任意の絶対パス）/ inline `script`。
  - 環境: `~/.claude/workflows/` 不在、既存スクリプト無し、Claude Code v2.1.158、`~/.claude` は git 配下。

## 調査結果（goal実態 / 現状実態 / ギャップ）

### goal実態（統合先 Workflow の能力と適合パターン）
- **調査向き**: multi-modal sweep（観点別に並列の調査agent）＋ completeness critic（抜け探し）。schemaで構造化して回収 → Opusが統合。
- **検証向き**: adversarial verify／perspective-diverse verify（設計一致・副作用・完了条件など視点を割った複数verifier）→ 多数決でOpus判定。
- **実行**: agentはClaude系サブエージェント。**codexそのものにはならない**（codexは外部CLI）。execの「手」は引き続き codex、Workflowは検証側に効かせるのが自然。
- 役割: Workflowは「並列の筋肉」、判断はOpusが保持 → `/goal` の哲学と整合。

### 現状実態（現行 /goal）
- `plan.md`: Opus単一ターン・同期。手順2の調査委譲は「sonnet 4.6 sub-agentに並列委譲**してよい**」の任意記述のみ（実体はAgentツール、前回実行では委譲せず直接調査）。`allowed-tools` に Workflow 無し。出力 `docs/plans/$ARGUMENTS.md`、ハードストップあり。
- `exec.md`: codex(gpt-5.5)が唯一の実行者。検証(c)は**Opus単一読解**（git diff＋対象ファイル）。`allowed-tools` に Workflow 無し。1task=1codex／per-task gate／中断条件あり。
- 環境: `~/.claude/workflows/` 不在、workflow script 無し。

### ギャップ
- **G1**: 調査が任意・ad-hoc・単一化しがち → 決定論的・並列・構造化の fan-out 未到達（再現性／網羅性不足）。
- **G2**: 検証(c)が単一読解 → 多視点・逆検証 未到達（乖離見落としリスク）。
- **G3**: 両コマンドの `allowed-tools` に `Workflow` 不在 → そもそも起動不可。
- **G4**: `~/.claude/workflows/`（スクリプト保管先）不在。
- **G5**: Workflowは背景・非対話 → 現行の同期・対話intakeと噛み合う設計（intakeを前段、結果統合を後段、複数ターン化）が未定義。

## 実行計画

> 段階導入を推奨（未確定#1）。**第1段=Plan統合（task-1,2,5）**／**第2段=Exec統合（task-3,4）**。下記は Scope-Both（フル）を全タスクとして記述し、第2段タスクに【Exec統合時のみ】と付す。

- [x] task-1: `~/.claude/workflows/` 新設＋plan調査ワークフロー script 作成 ✅完了・検証済（Opus作成）
  - 操作対象: `~/.claude/workflows/`（新規ディレクトリ）, `~/.claude/workflows/goal-plan-investigate.workflow.js`（新規）
  - 操作内容: 調査fan-out scriptを作成。構成＝`meta`（name/description/phases）→ `phase('Investigate')` で **goal実態 agent群 と 現状実態 agent群を `parallel` で並列**（各 `model:'sonnet'`、read-only、`agentType:'Explore'` 可、出力は構造化 `schema`：{構成要素, 繋がり, 気付き, 該当ファイル}）→ `phase('Critic')` で completeness-critic 1体（抜け観点を返す）→ 構造化結果（goal実態/現状実態/ギャップ素材）を `return`。fan-out数は `budget` 連動で可変、silent capは `log` で開示。**plan.md は書かない**（Opusが後段で統合）。
  - 影響場所と効果: `/goal:plan` の手順2を、並列・構造化・再現可能な調査に置換可能化。
  - goalへの影響: 調査網羅性・再現性が上がり計画精度が向上（G1解消・goalの中核）。

- [x] task-2: `plan.md` を Workflow 起動型に改修 ✅完了・検証済（codex/verbatim/.bak）
  - 操作対象: `~/.claude/commands/goal/plan.md`（改修前に `.bak` 退避）
  - 操作内容: frontmatter `allowed-tools` に `Workflow`（背景結果回収用に `TaskOutput`/`TaskGet` も）を追加。手順を「①対話intake（Workflow起動前に完了）→②`Workflow` を `scriptPath: ~/.claude/workflows/goal-plan-investigate.workflow.js`・`args`=goal/why/要件 で起動→③完了通知で再開し構造化結果を回収→④**Opusがplan.mdへ統合**→⑤ハードストップ」に書換。背景・非対話の制約と複数ターン化を本文明記。
  - 影響場所と効果: `/goal:plan` 実行時に調査Workflowが起動する運用へ。
  - goalへの影響: 既存plan運用へのWorkflow統合本体（G3部分解消）。

- [x] task-3:【Exec統合】exec検証ワークフロー script 作成 ✅完了・検証済（Opus作成）
  - 操作対象: `~/.claude/workflows/goal-exec-verify.workflow.js`（新規）
  - 操作内容: 入力＝{task-id, 対象ファイル群, plan設計抜粋, codex出力}。**視点分散の複数verifier**（`model:'sonnet'`、read-only、観点: ①plan設計一致 ②未指示の副作用/巻込み ③完了条件充足）を `parallel` 起動し、各々 git diff＋実ファイルを読んで構造化 `verdict`（{一致:bool, 乖離箇所, 根拠, 重大度}）を返す。多数決と全verdictを `return`（**最終判定はせず Opus に委ねる**）。
  - 影響場所と効果: `/goal:exec` の検証(c)を単一読解→多視点逆検証へ強化。
  - goalへの影響: 実行結果検証の精度向上（G2解消）。executor=codex／verifier=Claude原則は保持。

- [x] task-4:【Exec統合】`exec.md` を Workflow 起動型に改修 ✅完了・検証済（codex/verbatim/.bak）
  - 操作対象: `~/.claude/commands/goal/exec.md`（改修前に `.bak` 退避）
  - 操作内容: `allowed-tools` に `Workflow`（＋`TaskOutput`）追加。(c)検証を「task毎に codex実行(b)後、`goal-exec-verify` ワークフローを起動→verdict回収→**Opusが採否判定**→乖離なら(b)へ差し戻し」に改修。(b)codex実行は従来どおり同期・top-level（**Workflow内にcodexは入れない**＝役割分離とper-task gate維持）。1task=1codex／中断条件は不変。
  - 影響場所と効果: execの検証フェーズがWorkflow化。
  - goalへの影響: exec側の統合本体（G3残部解消）。

- [x] task-5: 回帰スモークテスト ✅完了（実起動成功・3エージェント稼働・構造化return確認）。**検証中に args 受け渡しバグを発見→修正済**: Workflowランタイムは args をJSON文字列で渡すため、両 script に防御的 `JSON.parse` を追加。echoで実配送形式を観測→ローカルでパース証明済
  - 操作対象: 軽量テストgoal（例: 既存bjj-flowchart上の些末な確認goal、または使い捨てslug）
  - 操作内容: 改修後の `/goal:plan`（必要なら `/goal:exec`）を軽量goalで実行し、(i)Workflowが起動し `/workflows` に進捗が出る (ii)構造化結果が回収され plan.md が生成される (iii)【Exec統合時】検証fan-outのverdictでOpus判定が回る、を確認。失敗時は `.bak` から即時ロールバック。
  - 影響場所と効果: 統合が実運用で機能することの担保。
  - goalへの影響: 「搭載」完了の検証（要件1の達成確認）。

## 未確定・要判断事項

1. **統合スコープ**（最重要）:
   - A（推奨）: 段階導入。**第1段=Plan統合のみ**（task-1,2,5）で効果確認 → 第2段でExec統合（task-3,4）。リスク最小・効果は計画品質という上流に最大投資。
   - B: 一括で Plan＋Exec 両統合。
   - C: Exec検証のみ統合（plan現状維持）。
2. **Workflow script の参照方式**:
   - A（推奨）: `scriptPath` 絶対パス（`~/.claude/workflows/*.js`）。global安全・name解決の global対応(未確認)に依存しない。
   - B: `name` 解決（`.claude/workflows/` がglobalで解決されるか要検証）。
   - C: コマンドmd内に inline `script` 埋め込み（自己完結だが冗長・保守性低）。
3. **背景/非同期の受容**: Workflowは背景・非対話。plan/execが「起動→背景→完了通知で再開→統合」の**複数ターン化**し、現行の同期単一ターンから挙動が変わる。
   - 推奨: 受容（並列性・`/workflows`可視化・構造化リトライの利得が上回る）。許容できないなら統合自体を再考。
4. **Workflowエージェントのモデル**: 調査・検証agent＝sonnet 4.6固定（メモリ方針「サブエージェントは常にsonnet 4.6・品質第一」と整合）／統合・最終判定＝Opus(main loop)。
   - 推奨: 上記のとおり（調査検証=sonnet、判断=Opus）。haikuは使わない。
5. **fan-out規模/予算**: タスク規模で agent 数を可変（`budget`連動）か固定Nか。
   - 推奨: 小goalは数体、"徹底/comprehensive"指定で増。打ち切りは `log` で開示（silent cap禁止）。
6. **execでcodexをWorkflow内に取り込むか**:
   - A（推奨）: 取り込まない。codexはtop-level同期、Workflowは**検証専用**。役割分離・per-task gate・中断条件を保てる。
   - B: pipeline化しagentがcodexをBash実行。効率は上がるが境界が曖昧化・gateが緩む。
7. **既存改修 vs 新コマンド併設**:
   - A（推奨）: `.bak` 退避の上で**既存 plan.md/exec.md を改修**（背景: ユーザは「既存に統合」と明言）。
   - B: `/goal:plan-deep` 等を併設し現行を温存（後方互換重視だがコマンド分裂）。
8. **opt-in/コスト周知**: コマンドにWorkflow起動を常設すると `/goal` が既定で多エージェント＝トークン増。常時起動か、引数/閾値で条件起動か。
   - 推奨: 第1段は常設で様子見、重い時のみ条件分岐を後付け。

---

plan.md を確認・編集のうえ `/goal:exec ~/.claude/docs/plans/goal-workflow-integration.md` を実行してください。
