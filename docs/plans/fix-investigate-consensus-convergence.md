# Goal: investigate の consensus 出口デッドを解消する（合成案＝dme 根本解）

`goal-plan-investigate.workflow.js` の critic consensus が一度も成立しない（毎ラウンド 0/3 sufficient、常に maxRounds/stall まで回る）問題を、dme の根本（③基準 moat を workflow が auto-close している）から解消する。

## 背景（なぜ / 要件 / 前提）

**なぜ / 根本（dme 垂直再帰）**: 表層原因は「『抜けはあるか（critic は常に Yes）』と『十分か』を1つの `sufficient` boolean に潰した」こと。一段深い根本は **workflow が dme の ③基準（どの抜けが stakes を持つか＝価値判断 moat）を自分で auto-close しようとしている**こと。`default to insufficient` は moat を片側に釘付けしただけ。dme は「照合（抜け探し）＝AI 強い／基準（どの乖離が効くか）＝人間。Claude は基準の候補を出すが確定は返す」と規定する。

**設計方針（合成）**:
- critic は **severity 付きで抜けを*提案*** する（① ② ＝ AI 主体）。
- 十分性の ***確定* は workflow が握らず**、`consensusComplete`=「high gap ゼロ＝収束」シグナルに reframe。
- 残存 high gap は **人間（Opus→plan の ⚖️）に escalate**（auto-close しない）。

**要件**:
1. consensus が実際に到達可能（high gap が無ければ round 1 で早期収束）。adversarial な抜け列挙の厳しさは維持。
2. 返却 schema 後方互換: `critic.{consensusComplete, sufficientVotes, totalLenses, missingAngles(string[]), unverifiedClaims, suggestedFollowups, lenses}` の形・型不変。追加は新キーのみ。
3. read-only / loop 構造（MAX_ROUNDS / stall / budget 終了保証）維持。
4. workflow は十分性を確定しない。residual high gap は人間に返す。

**前提**:
- 現行 `CRITIC_SCHEMA.sufficient`(L119) は自己申告 boolean、prompt(L205)「デフォルトで不十分に倒す」、`aggregateCritic`(L180) `consensusComplete = sufficientVotes>=2`。
- missingAngles は現状 string[]。`{angle,severity}` を `"[severity] angle"` に flatten すれば後方互換。
- この fix は PR-1（v4 consensus ループ）を拡張する。現在 PR-1 ブランチ上で実装。

## 調査結果（goal実態 / 現状実態 / ギャップ）

- **goal実態**: 早期収束には「もう調査を増やす必要が無い」を*人間の基準で*判定できる必要。現状は主観 boolean＋insufficient 既定で不可能、かつ workflow が確定を握っている。
- **現状実態**: critic は harsh gap-finder として機能（毎ラウンド 13-14 gap）。sufficient は常に false。stall ガードだけが実出口。
- **ギャップ**: (a) critic を「severity 提案」に、(b) consensus を「high gap ゼロ＝収束」に、(c) residual high gap を escalate、(d) plan 側で ⚖️ として人間に返す。

## 実行計画（2タスク）

- [ ] task-1: critic 機構を「severity 提案＋収束＋escalate」に（workflow.js）
  - 操作対象: `workflows/goal-plan-investigate.workflow.js`（CRITIC_SCHEMA / critic prompt / aggregateCritic / consensus loop）
  - 操作内容:
    1. CRITIC_SCHEMA: `missingAngles` を `{angle:string, severity:'low'|'medium'|'high'}[]` に。`sufficient` boolean を削除（critic は十分性を判定しない）。required 更新、additionalProperties:false 維持。
    2. critic prompt: `敵対的に粗を探す`・`他レンズと重複せず` は維持。`判断はデフォルトで「不十分」寄りに倒す` を削除し、`抜けは全て severity 付きで提案せよ（列挙は敵対的に厳しく）。high はこの抜けを埋めずに plan を書くと plan が誤る/危険になるものに限る。十分かは判定しない（人間が確定する）` に置換。
    3. aggregateCritic: 返却 `missingAngles` は `[severity] angle` に flatten して string[] 維持。`consensusComplete` = 全レンズ通して high-severity gap がゼロ（＝収束）。`sufficientVotes` = high gap を出さなかったレンズ数。新キー `unresolvedHighGaps`(string[]) を追加（既存キー不変）。
    4. consensus loop: 再 probe を high-severity gap 優先に。MAX_ROUNDS/stall/budget の終了保証維持。終了後 high gap が残れば `unresolvedHighGaps` で返す（auto-close せず escalate）。
  - 影響場所と効果: high gap が無ければ早期収束（コストも下がる）。high gap は人間に escalate。
  - goalへの影響: 要件1-4。dme の moat 帰属を正す根本解。
  - Tier: A（ロジック・テストで捕まりにくい収束挙動 → フル検証）

- [ ] task-2: plan.md step3 を「workflow は十分性を確定しない・residual を ⚖️」に（plan.md）
  - 操作対象: `commands/goal/plan.md`（手順3）
  - 操作内容: 現行「`consensusComplete=false` なら薄い観点を Opus が補完」を、「**workflow は十分性を確定しない**。`unresolvedHighGaps`（残存 blocking gap）があれば Opus はそれを `## 未確定・要判断事項` の ⚖️ として人間に返す（auto-close しない）。`consensusComplete=true`（収束）でも high gap 以外の薄い観点は必要に応じ補完してよい」に更新。
  - 影響場所と効果: ③基準 moat が確実に人間へ届く。
  - goalへの影響: 要件4。dme「確定は人間に返す」の最終フック。

## 未確定・要判断事項

- ⚖️ **severity ルブリックの確定（消えない moat）**: 「何を high（=blocking）とするか」は dme 上どうしても人間の ③基準。本案は critic が*提案*し、residual high gap を毎回 *surface* する形にするだけ（auto-close しない）。「plan を誤らせる/危険にする抜けだけ high」が出発点の rubric だが最終線引きは人間。
- consensusComplete 判定は「全レンズ high ゼロ」（AND）。residual を escalate する設計なので「単独レンズの high を多数決で握り潰す」危険が無く、AND が安全（Q3 はこの設計で溶ける）。

## PR仕様

- PR: PR-1（`feat/goalflow-v4-plan-tournament`）を拡張（consensus ループの根本修正）
  - 目的: consensus 出口を機能させ、blocking gap が無ければ早期収束、residual blocking gap は人間に escalate する。
  - 満たすべき要件: 返却 schema 後方互換（既存キー不変＋`unresolvedHighGaps` 追加）/ loop 構造・終了保証維持 / adversarial 列挙維持 / workflow は十分性を確定しない。
  - 着手前 / 完了後: consensus 永遠に不成立・workflow が moat を auto-close → high gap ゼロで早期収束、residual は ⚖️ で人間へ。
  - 作業フロー図（mermaid）:
    ```mermaid
    flowchart TD
      A[task-1: critic を severity 提案へ / sufficient 廃止] --> C[node --check]
      B[task-1: consensus=high gapゼロ収束 / unresolvedHighGaps escalate] --> C
      D[task-2: plan step3 で residual を ⚖️ 人間へ] --> E[最小 goal で round1 早期収束＋high gap escalate を確認]
      C --> E
    ```
  - Verification: `node --check workflows/goal-plan-investigate.workflow.js`（＋blocking gap 無し小 goal で round1 収束、blocking gap あり goal で high 優先再 probe＋residual escalate を確認）。初回は exec 権限外のため Claude 照合＋人間の `!` 実行。
  - 解決タスクと goal への効果: task-1（収束＋escalate の本体）, task-2（人間への ⚖️ フック）。
  - PR外への影響: 返却 schema 後方互換のため plan.md 呼び出し側は task-2 の step3 文言更新のみ。exec 側（goal-exec-verify）は別物・無関係。
  - その他共有事項: PR-1（#11）への追加コミットになる（v4 plan 側の根本改善として同梱）。
