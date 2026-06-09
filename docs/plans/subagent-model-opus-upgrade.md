# Goal: Claude Code の subagent モデルを Sonnet(現 4.6) から Opus(4.5/4.6/4.7) へ引き上げるべきか、引き上げる場合の箇所別最適を判断する

対象は `'sonnet'` エイリアスを使う **全3箇所**：
- **(A) probe** … `workflows/goal-plan-investigate.workflow.js:75`（`agentType:'Explore'`, read-only, fact収集）
- **(B) critic** … `workflows/goal-plan-investigate.workflow.js:141`（多票consensus, 完全性クリティック）
- **(C) verify** … `workflows/goal-exec-verify.workflow.js:80`（多票consensus, 実装逆検証）

---

## 背景（なぜ / 要件 / 前提）

### なぜ
- 調査精度の **予防的な底上げ**。観測された失敗は無し。現状トークン量・スピードには満足。
- 精度の上限を上げられるか、上げる価値があるかを判断したい。
- 引き上げ先は **Opus 4.5/4.6/4.7 に限定**（最新 4.8 は意図的に除外。orchestrator(4.8) 未満の tier に抑える方針）。

### 要件
1. そもそも現運用で精度をさらに求める必要があるのか。**箇所別**に、subagent 出力が後段（Opus orchestrator / 多票consensus / 最終採否）でどれだけ回復・補正されるか、それとも load-bearing かを評価する。
2. 精度向上が期待される場合の **トークン量とスピードの変化量の推測値**（Opus vs Sonnet）。

### 前提（intake で確定）
- 「Opus orchestrator がハンドルできている箇所は Sonnet で十分。より精度が要る箇所だけ Opus」という箇所別方針。
- subagent の model 指定は **バージョン固定でなく tier エイリアス `'sonnet'`**（`claude-sonnet-4-6` の固定値はリポジトリに不在）。
- orchestrator は `claude-opus-4-8`（`commands/goal/plan.md:4`, `exec.md:4`）。codex は gpt-5.5 xhigh priority。

---

## 調査結果（goal実態 / 現状実態 / ギャップ）

### 確定した技術事実（実機・実ログ・公式pricingで grounding 済み）

| 項目 | 事実 | 根拠 |
|---|---|---|
| `'sonnet'` の解決先 | `claude-sonnet-4-6` | session jsonl 948件 |
| `'opus'` の解決先 | **`claude-opus-4-8`**（=4.8） | `agent-adb28d95941792985.jsonl` 実ログ |
| バージョン固定IDの存在 | `claude-opus-4-5(-20251101)` / `4-6(-20251101)` / `4-7` / `4-8` すべて binary の認識リストに実在 | `claude-darwin-arm64` 直 grep |
| `agent()` opts.model | string 型・enum 制約なし。tier alias と full ID の両方を受理（doc文字列）。`settings.json` に allowedModels 制限なし | binary doc / settings.json |
| Opus 4.7 の API 可用性 | **現行・課金対象**（$5/$25 per Mtok） | 公式 pricing(2026-05) |
| `[1m]` サフィックス懸念 | **terminal escape のアーティファクトで実在せず**（クリーン grep で消滅） | 再 grep で解消 |
| `agentType:'Explore'` と model の干渉 | **干渉しない**。明示した model opt が優先（probe は Explore でも全件 sonnet-4-6）。`Explore=Haiku` は model 未指定時の既定であり fastMode 文脈の話。常に model 指定する本構成では無関係 | jsonl 実証 |
| fastMode | `settings.json` に未設定（effortLevel:xhigh）。subagent への非波及。model 変更と干渉なし | settings.json |

### 要件#2：トークン量・スピードの変化量（推測値）

**コスト（per-token 単価）— 公式 pricing で確定:**
- Sonnet 4.6 = **$3 / $15**（入/出, per Mtok）
- Opus 4.7 = **$5 / $25** → **1.67x**（入出とも。歴史的な ~5x ではなく想定よりかなり小さい）
- Opus 4.7 は新tokenizerで同一テキストに **最大 +35%** のトークン生成 → 出力寄り処理では実効 ~1.35x 上乗せ。
- 本 subagent は **入力支配**（probe=ファイル読み、critic/verify=findings/diff 読み。出力は schema 拘束の構造化JSONで小さい）→ 実効コスト増は概ね **1.7〜2.3x**（単価 1.67x が下限、Opus の thinking トークン増で上振れ）。

**スピード（レイテンシ）— 推計（公式数値なし・経験則）:**
- Opus は Sonnet よりスループットが低く thinking トークンも多い → 1エージェントあたり概ね **1.5〜2.5x** のwall-clock増。
- workflow は subagent を **並列**起動するため、全体時間は最遅エージェント律速。全箇所 Opus 化すると並列バッチ全体がこの係数で押し上がる。
- **実測アンカー**：今回の plan investigate（probe 2 + critic 3 = 5 並列, Sonnet）は **約7.3分**。全 Opus 化で **約11〜18分**の見込み。exec verify（3並列/task）も同係数。

**1回あたりのエージェント数（コスト/速度の母数）:**
- plan investigate（budget target なし時）：probe = `perSide*2` = **2** ＋ critic = **3** ＝ 計 **5**。
- exec verify：**3** / task。

### 要件#1：箇所別の load-bearing 度と「精度をさらに求める必要」の評価

| 箇所 | 役割 | 後段の補正層 | load-bearing 度 | Opus化の限界効用 |
|---|---|---|---|---|
| **(A) probe** | raw fact 収集（Explore/read-only） | critic が findings 全体を再評価 ＋ Opus が consensus 不十分時に自力補完（**2段補正**） | 低 | **低**（最もファイル読みが多くコスト最大、なのに最も回復しやすい） |
| **(B) critic** | 完全性 judgment（sufficient/抜け） | 多票consensus ＋ Opus が consensus=false 時に自力補完 | 中（judgment だが最終決定ではない） | **低〜中** |
| **(C) verify** | 実装逆検証 judgment（matches/deviation） | 多票consensus ＋ **Opus が git diff/実ファイルを自読して最終採否**（exec.md:40） | 中（差し戻しトリガー。ただし採否は Opus） | **低〜中** |

**結論（要件#1への回答）：現運用で精度をさらに求める強い必要は無い。**
- アーキテクチャが構造的に「Sonnet=並列調査/critic/verify、Opus=統合・判断のバックストップ」（CLAUDE.md:13-18 の明文方針）になっており、Sonnet 層の誤りは Opus 層で回復可能な設計。
- 観測された失敗が無く、**今回の調査自体が Sonnet 層の高品質を実証**した：probe は binary 実機IDや実ログまで掘り当て、critic は未検証主張・`[1m]`アーティファクト・ドキュメント整合の抜け・要件#2の空白まで敵対的に指摘した（=Sonnet critic が十分機能）。
- 一方で Opus 化のコストは実在（単価 1.67x＋、速度 1.5〜2.5x）。**probe は限界効用が最も低くコストが最も高い**ため Opus 化の費用対効果が最悪。

### ギャップ（goal到達に必要な差分）と、引き上げる場合の波及

1. **「4.8除外」と「精度向上」が衝突**：`'opus'` は 4.8 に解決されるため、4.5/4.6/4.7 限定にはバージョン固定ID（`claude-opus-4-7`）が必須。しかし 4.7 < 4.8 の能力であり、**精度目的なのに弱い Opus を選ぶ**という自己矛盾を含む。さらに固定IDは将来の retire で script 保守が必要（4.5/4.6 は既に dated snapshot 付き）。
2. **方針ドキュメント整合の連鎖**（変更する場合は in-scope。放置すると次回 /goal:plan の risk critic が「方針違反」と誤診断）：
   - `CLAUDE.md:13-18`（「調査・逆検証・レビュー・critic は Sonnet が担当」）
   - `projects/-Users-ooizumiyou/memory/feedback_subagents.md`（「サブエージェントは常に sonnet 4.6」）
   - `commands/goal/plan.md:67` フォールバック文言（「sonnet 4.6 のsub-agent」）※ exec.md は sonnet 言及なし＝対象外
   - `workflows/goal-plan-investigate.workflow.js:5` meta description（「sonnet/Explore」）
   - `docs/plans/goal-workflow-integration.md:84`、`memory/reference_goal_workflow.md:26`（設計記録）
3. **agentType の非対称**：probe は `agentType:'Explore'`（read-only）、critic/verify は agentType 未指定（default workflow agent）。critic/verify を Opus 化する場合、より広いツールを使う可能性に備え `agentType:'Explore'` 明示 or read-only 制約強化を同タスクに含めるのが安全。

---

## 実行計画

> 注：以下のタスクは **「未確定・要判断事項」での決定に依存して採否・対象が決まる**（特に決定#1=上げるか、#2=モデル値、#3=対象箇所）。現状維持を選ぶ場合、本実行計画は不要となる。

- [ ] **task-1: 対象 workflow.js の model 指定を決定値へ変更**
  - 操作対象: 決定#3で選ばれた箇所のみ — `(A) goal-plan-investigate.workflow.js:75` / `(B) 同:141` / `(C) goal-exec-verify.workflow.js:80`
  - 操作内容: 各該当行の `model: 'sonnet'` を決定#2の値（`'claude-opus-4-7'`（4.8除外を満たす） or `'opus'`（=4.8））へ置換
  - 影響場所と効果: 当該 subagent の使用モデルが変わる。他行・他ロジックは不変。probe を据え置く場合 (A) は変更しない
  - goalへの影響: 「箇所別に必要な精度だけ Opus」を実現する中核変更
- [ ] **task-2: 方針ドキュメントの整合更新**（task-1 で1箇所でも Opus 化する場合は必須）
  - 操作対象: `CLAUDE.md:13-18` / `feedback_subagents.md` / `commands/goal/plan.md:67` / `goal-plan-investigate.workflow.js:5`(meta) / `docs/plans/goal-workflow-integration.md:84` / `memory/reference_goal_workflow.md:26`
  - 操作内容: 「調査・critic・verify は Sonnet」という記述を、実装後の実態（どの箇所がどのモデルか）と一致させる。4.8除外の設計根拠も併記
  - 影響場所と効果: 方針文書と実装の乖離を防ぎ、次回 /goal:plan の risk critic 誤診断を回避
  - goalへの影響: goal そのものではないが、放置すると運用が壊れる必須の随伴変更
- [ ] **task-3 (任意): critic/verify の read-only 制約明示**（task-1 で (B)/(C) を Opus 化する場合のみ）
  - 操作対象: `goal-plan-investigate.workflow.js:141`（critic）/ `goal-exec-verify.workflow.js:80`（verify）の agent opts
  - 操作内容: `agentType:'Explore'` 追加 or プロンプトの read-only 制約強化
  - 影響場所と効果: Opus 化に伴うツール権限拡大の副作用を予防
  - goalへの影響: 安全性確保の補助。精度自体への寄与は小

---

## 未確定・要判断事項

> **オーケストレーター（Opus）としての総合推奨**：要件#1 の調査結果は **現状維持（全箇所 Sonnet）が妥当**を示す（限界効用低・CLAUDE.md 方針整合・コスト/速度増・「4.8除外」の自己矛盾）。引き上げるなら **probe は据え置き、critic/verify のみを対象に、まず1回試走して体感差を測ってから本採用**を推奨。最終判断はユーザに委ねる。

1. **そもそも引き上げるか**
   - (a) **現状維持（推奨）**：全箇所 Sonnet。コスト/速度/方針すべて据え置き。
   - (b) 引き上げる：以下の #2〜#4 を決める。
2. **モデル値（引き上げる場合）**
   - (a) `'claude-opus-4-7'` 固定：要件「4.8除外」を満たす。ただし 4.7<4.8 で精度目的に対し弱く、将来 retire 時に script 保守が必要。
   - (b) `'opus'`（=4.8）：最強・最簡（エイリアスで自動追随・保守不要）。ただし「4.8除外」方針に反する。**精度最優先なら本来こちら**。
   - (c) Sonnet 維持＋別改善（プロンプト強化・lens 追加・perSide 増）：モデル据え置きで精度を狙う代替路。
3. **対象箇所（引き上げる場合）**
   - probe(A) は据え置き推奨（限界効用最低・コスト最大）。上げるなら **critic(B)/verify(C)** に限定。
4. **「4.8除外」の設計根拠**を要件/plan に明記するか（根拠＝コスト管理 / 役割階層の明確化 / 4.8 を orchestrator 専用に保つ 等）。根拠なき制約は将来 reviewer に撤廃されるリスク。
5. **測定先行の是非**：critic か verify を1回だけ `claude-opus-4-7` で試走し、findings/verdict の質差を目視してから本採用するか。

---

## PR仕様（PR / スコープごと。/goal:exec はこの仕様どおりに PR 本文を書く）

> PR は決定#1で「引き上げる」を選んだ場合のみ作成。現状維持なら本 plan は調査記録として残し PR 不要。

- **PR-1: `~/.claude`（dotfiles リポジトリ） — subagent モデル引き上げ ＋ 方針ドキュメント整合**
  - 目的: 決定#3で選んだ subagent 箇所のモデルを Sonnet から決定#2の Opus 値へ引き上げ、関連する方針ドキュメントを実態と整合させる。
  - 満たすべき要件:
    - 要件#1/#2 の調査結論（本 plan）に基づき、**probe は原則据え置き**、対象は critic/verify に限定。
    - モデル値は決定#2で確定（`'claude-opus-4-7'` or `'opus'`）。「4.8除外」を採るなら固定ID＋保守注記を併記。
    - 方針ドキュメント（CLAUDE.md / feedback_subagents.md / plan.md:67 / workflow meta / 設計記録）を実装後の実態と一致させる。
  - 着手前の立ち位置 / 完了後の立ち位置:
    - 着手前: 全3箇所が `model:'sonnet'`。CLAUDE.md は「調査・critic・verify=Sonnet」と明記。
    - 完了後: 決定箇所が Opus（決定#2値）。残りは Sonnet。方針文書が実態と一致し、4.8除外の根拠も記録済み。
  - 作業フロー図（mermaid。本PRでの作業内容を図示）:
    ```mermaid
    flowchart TD
      A[着手前: 全3箇所 model:'sonnet' / CLAUDE.md=Sonnet方針] --> B[task-1: 決定箇所の model を Opus決定値へ置換]
      B --> C[task-3 任意: critic/verify に agentType:'Explore' 等 read-only 制約明示]
      C --> D[task-2: CLAUDE.md/feedback/plan.md:67/meta/設計記録を実態へ整合 + 4.8除外根拠を明記]
      D --> E[完了後: 決定箇所=Opus, 残り=Sonnet, 方針文書と実態が一致]
    ```
  - 解決タスクと goal への効果: task-1（中核＝箇所別モデル引き上げ）/ task-2（方針整合＝運用破綻の防止）/ task-3（任意＝Opus化の副作用予防）。goal「箇所別最適」を実装に落とす。
  - PR外への影響: なし（変更は `~/.claude` 内に閉じる。実行時コスト/レイテンシは前述の推計どおり増えるが、外部リポジトリ・他プロジェクトのコードには波及しない）。
  - その他共有事項: モデル固定ID（`claude-opus-4-7`）採用時は、将来 retire で本ファイル群の再編集が必要になる旨をコメントで残すこと。コスト増は単価 1.67x＋／速度 1.5〜2.5x が目安。

---

**plan.md を確認・編集のうえ /goal:exec を実行してください。**
（要件#1 の調査結論は「現状維持が妥当」です。引き上げる場合は上記「未確定・要判断事項」#1〜#5 を確定してから exec してください。）

> Sources（要件#2 の pricing 根拠）:
> - [Claude API Docs — Pricing](https://platform.claude.com/docs/en/about-claude/pricing)
> - [Anthropic API Pricing 2026 (pecollective)](https://pecollective.com/tools/anthropic-api-pricing/)
> - [Claude API Pricing 2026 (TLDL)](https://www.tldl.io/resources/anthropic-api-pricing)
