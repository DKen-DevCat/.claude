# Goal: /goal:plan に dme を skill 呼び出し形で統合する

`/goal:plan` の「構造判断」を司る認知層（ギャップ特定・計画作文・PR境界決め）を、コマンド本文へのベタ書きから、進化する **dme skill の呼び出し** へ委譲する。dme をコピーせず `Skill(dme)` で呼ぶことで、dme の進化が次回以降の plan からタダで反映される状態にする。

## 背景（なぜ / 要件 / 前提）

**なぜ**: `/goal:plan` の step4「Opus自身がギャップ特定と計画作文を行う」は、構造判断のロジックがコマンド本文に凍結されている。一方 dme は「構造判断（スコープ+観察→推測→検証＋⚖️moat）」を専門に進化させているスキル。今は両者が二重管理になっており、dme の進化が plan に反映されない。

**要件（このセッションの対話で確定）**:
- **skill 呼び出し形**: dme のロジックをコマンドへコピーせず `Skill(dme)` で呼ぶ。dme 更新の自動反映が必須要件（ユーザの中核要望）。
- **boundary = Opus 本体のみ**: dme は Opus 本体が呼ぶ。調査Workflow（`goal-plan-investigate`）は不変。役割分担（判断=Opus / 調査=sonnet）と整合。
- **トリガー = 常時**: `/goal:plan` の高度では仕事が常に構造判断なので発火ゲートは不要。深さは dme の浮上規則で自律制御。
- **リズム = ハイブリッド**: dme は自走で ⚖️moat を浮上 → 「未確定・要判断事項」へ直列化。goal/要件に効く高stakesの ⚖️ だけ plan.md 確定前に確認する。
- **出力 schema は不変**: boundary=Opus本体のみを選んだため、plan.md の出力契約（未確定・要判断事項の構造等）は今回作り替えない。

**前提（実態確認済み）**:
- dme は SKILL.md 上「**自走前提**」。人間に返るのは狭い2点（①初期スコープの枠決め＋前提疑い / ③何を基準にズレを見るか）のみ。②推測・③照合・①操作スコープ分解・深さ判断は Claude が主体的に回す。→ dme と `/goal:plan` のリズムは衝突せず同型（自走→moat浮上→停止）。
- `/goal:plan` は実は dme を2高度で回している: ①観察+③照合=調査Workflow（産業化された凍結インフラ）、②推測+③基準+⚖️=コマンド本文にベタ書きの認知層、plan.md/PR仕様への直列化=dme が持たない成果物層。
- このセッション自体が統合のドッグフーディング（`Skill(dme)` で本統合を設計した）。

## 調査結果（goal実態 / 現状実態 / ギャップ）

**goal実態（あるべき姿）**: step4 の構造判断が `Skill(dme)` 起動になっており、dme が自走で「タスク構造＋PR境界」を構造判断し ⚖️moat を返す。返った moat は未確定・要判断事項へ直列化され、高stakesのみ確認に上がる。dme SKILL.md の更新が次回 plan から自動で効く。

**現状実態**:
- `~/.claude/commands/goal/plan.md` step4(26–29行)＝「Opus自身がギャップ特定と計画作文」。dme 参照なし。
- frontmatter `allowed-tools`(5行)＝ `Read, Grep, Glob, Bash(git log:*), Bash(git diff:*), Write, Workflow, TaskOutput, TaskGet, Task`。**`Skill` も `AskUserQuestion` も無い**。
- step5(30行)＝「判断が割れる分岐は未確定・要判断事項に列挙」。step6(31–35行)＝PR分割（＝dmeの「どこを切るか」判断に相当するが暗黙）。
- 調査Workflow `goal-plan-investigate.workflow.js`＝並列probe（①観察）＋多票critic coverage/grounding/risk（③照合）。既に dme ①③ の産業化版。
- `~/.claude/skills/dme/SKILL.md` 存在。Skill ツールから `dme` 呼び出し可能。
- commands/workflows 内に既存の dme/Skill 参照は **ゼロ**（クリーンスレート）。

**ギャップ**:
1. コマンドが `Skill(dme)` を呼べない（allowed-tools に `Skill` 不在）。物理的前提が欠けている。
2. step4 が dme ではなくベタ書き認知。委譲されていない。
3. ハイブリッドリズム（高stakes ⚖️ の確認）の経路が無い（`AskUserQuestion` 不在＋手順未記載）。
4. PR境界（step6）が dme の「どこを切るか」judgment として明示されていない。

## 実行計画

- [ ] task-1: frontmatter に `Skill` / `AskUserQuestion` を追加
  - 操作対象: `~/.claude/commands/goal/plan.md` の 5行目 `allowed-tools`
  - 操作内容: 既存リストの末尾に `, Skill, AskUserQuestion` を追加する（他のツールは現状維持）。
  - 影響場所と効果: コマンド本体（Opus）が step4 で `Skill(dme)` を、高stakes moat で `AskUserQuestion` を呼べるようになる。これが無いと統合自体が物理的に不可。
  - goalへの影響: skill 呼び出し形（進化自動反映）の前提インフラ。統合の物理的可否を決める。

- [ ] task-2: step4 を `Skill(dme)` 起動に書き換え（統合の中核）
  - 操作対象: `~/.claude/commands/goal/plan.md` step4（26–29行）
  - 操作内容: 「Opus自身がギャップ特定と計画作文」を「Opus が **`Skill(dme)` を起動**し、findings/critic を素材に dme ループ（②推測を主、①③は findings に対する照合）で goal–現状ギャップから **タスク構造と PR境界** を構造判断する。dme は自走し、構造＋⚖️moat を返す」に書き換える。あわせて **dme 出力 → plan.md schema のマッピング**を明記する（dme②推測→実行計画/PR仕様、dme⚖️moat→未確定・要判断事項、dme③照合→findings/critic との突き合わせ）。dme をコピーせず必ず Skill 経由で呼ぶ旨を明示。
  - 影響場所と効果: 構造判断の認知層が凍結プロンプトから進化する dme skill へ委譲される。dme SKILL.md 更新が次回 plan からタダで反映される。
  - goalへの影響: 「ベタ書き②認知層を解凍して `Skill(dme)` に委譲」という goal の中核を実現する。

- [ ] task-3: ハイブリッドリズムの接続＋intake条件付き dme
  - 操作対象: `~/.claude/commands/goal/plan.md` step5（30行）と step1（15–16行）
  - 操作内容: step5 を「dme が出した ⚖️moat を『未確定・要判断事項』へ直列化する。ただし **goal/要件に効く高stakesの ⚖️ は plan.md 確定前に `AskUserQuestion` で確認**してから作文する（hybrid）」に改める。step1 末尾に「**goal が曖昧な場合**は intake 段でも `Skill(dme)` で枠組み（初期スコープ・前提）を構造化してから investigation を起動してよい」を追記（条件付き）。**出力 schema 自体は変更しない**（boundary=Opus本体のみを尊重）。
  - 影響場所と効果: dme の「自走→moat浮上」リズムを plan の一回停止フローに正しく接続する。出力契約は不変のまま。
  - goalへの影響: 「ハイブリッド」決定の実装。dme native リズムを壊さず plan.md の解決度を上げる。

- [ ] task-4: step6 の PR境界を dme judgment として明示
  - 操作対象: `~/.claude/commands/goal/plan.md` step6（31–35行）
  - 操作内容: PR/スコープ分割が dme の「**① どこを切るか**」moat そのものである旨を明記し、PR境界も step4 の `Skill(dme)` ループの産物として導く（分割の根拠・代替案を ⚖️ で開示し、割れる場合は未確定・要判断事項へ）。PR仕様 schema 自体は不変。
  - 影響場所と効果: 今まで暗黙だった PR 分割判断が dme 経由の明示判断になる。
  - goalへの影響: dme の看板判断「どこを切るか」を plan の PR 設計に効かせる。

## 未確定・要判断事項

- **`AskUserQuestion` を allowed-tools に追加するか**: hybrid の高stakes確認に使うなら必要（task-1 で追加する前提で計画済み）。不要なら通常の会話＋停止で代替も可能。→ **推奨: 追加**（このセッションでも有効だった）。異論あれば task-1 から外す。
- **`/goal:exec` への対称統合**: exec も step(a)指示明確化・検証で同型。dme を exec にも噛ませるかは **本 goal のスコープ外**。別 goal として起こすか判断が要る（exec の allowed-tools にも `Skill` は無い）。
- **出力契約の dme 3モードラベル化**: コマンド本文を①②③で明示ラベル化し「未確定・要判断事項」を ⚖️moat 構造へ作り替える案（boundary質問の選択肢C）は、今回 boundary=Opus本体のみを選んだため**見送り**。将来オプションとして保留。
- **PR の base ブランチ**: `~/.claude` リポジトリの運用（直近は `develop`→`main` の PR）。base=`develop` でよいか確認（グローバル既定も `develop`）。

## PR仕様（PR / スコープごと。/goal:exec はこの仕様どおりに PR 本文を書く）

- PR-1: `~/.claude` リポジトリ / `commands/goal/plan.md` への dme 統合
  - 目的: `/goal:plan` の構造判断（②推測＋①③ moat 浮上）を、進化する dme skill へ `Skill(dme)` 呼び出しで委譲する。
  - 満たすべき要件:
    - skill 呼び出し形（dme をコピーしない・進化を自動反映）
    - boundary = Opus 本体のみ（調査Workflow と exec.md と dme SKILL.md は不変）
    - トリガー = 常時（深さは dme の浮上規則で自律）
    - リズム = ハイブリッド（⚖️→未確定事項、高stakesのみ `AskUserQuestion`）
    - plan.md の出力 schema は不変
  - 着手前の立ち位置 / 完了後の立ち位置:
    - 着手前: step4 は Opus がベタ書きで計画作文。`allowed-tools` に `Skill` 無し。dme 参照ゼロ。
    - 完了後: step4 は `Skill(dme)` を起動し dme が自走で構造判断。`allowed-tools` に `Skill`(+`AskUserQuestion`)。⚖️moat が未確定事項へ直列化＋高stakes確認。PR境界も dme judgment として明示。dme 進化が次回 plan から自動反映。
  - 作業フロー図（mermaid。本PRでの作業内容を図示）:
    ```mermaid
    flowchart TD
      A["着手前: step4はベタ書き計画作文 / allowed-toolsにSkill無し"] --> B["task-1: frontmatter allowed-tools += Skill, AskUserQuestion"]
      B --> C["task-2: step4をSkill(dme)起動に書換 / dme出力→plan.md schemaマッピング明記"]
      C --> D["task-3: hybridリズム接続(⚖️→未確定事項/高stakes確認) + intake条件付きdme"]
      D --> E["task-4: step6 PR境界をdmeの『どこを切るか』moatとして明示"]
      E --> F["完了後: /goal:planがSkill(dme)自走で構造判断 / dme進化を自動反映"]
    ```
  - 解決タスクと goal への効果: task-1〜4 を全て解決。task-1 が物理前提、task-2 が中核委譲、task-3 がリズム接続、task-4 が PR境界の明示化。合わせて「dme を skill 呼び出し形で統合」を完成させる。
  - PR外への影響: 調査Workflow（`goal-plan-investigate.workflow.js`）・`exec.md`・dme SKILL.md は変更しない（boundary=Opus本体のみ）。→ **なし**。
  - その他共有事項: dme SKILL.md の進化は本 PR 後タダで反映される。`/goal:exec` への対称統合は別 goal。出力契約の3モードラベル化は将来オプションとして保留。
