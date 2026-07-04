# Goal: /goal:plan・/goal:exec の自前スクリプト3層を「公式機構へ寄せる」観点で調査し、達成可能な磨き込み（A帯）に絞って堅牢化する

> 出力先メモ: コマンド指定の literal filename は `:` 改行 `。` `、` を含み正規化が必要なため、
> CLAUDE.md の `<goal-slug>` 規約に従い `docs/plans/goalflow-scripts-officialize.md` に正規化した。

## 背景（なぜ / 要件 / 前提）

**なぜ**: ユーザは「goal:plan / exec に自前スクリプトがある。もっと汎用化して、hooks 等の公式機構に差し替えたい」と要望。保守コスト・脆さ・配布性を一段上げたい意図。

**要件（intake 確定）**:
- 対象 = 全3層（① `commands/goal/*.md` ② `workflows/goal-*.workflow.js` ③ `hooks/codex-exec-guard.sh` + settings.json 登録）。
- 当初の狙い3つ（bespoke 削減 / 脆さ・ハック排除 / plugin 化・配布可能）を投げたが、**調査結果を受けてユーザが射程を確定**:
  - **成功の定義 = A帯（磨き込み）で十分**。plugin 化・agents 外出しは見送る。
  - **perl timeout = coreutils 依存で gtimeout 置換**（評価軸＝公式コマンド純度を採用、依存追加を許容）。
- codex(gpt-5.5) は実装者として固定維持。役割反転フロー・既存契約（1タスク=1 codex / commit-before-verify / plan-exec 契約 / **exec.md は編集禁止 veto**）は壊さない。

**前提（調査で実ファイル/実機/changelog 確認済み・確定事項）**:
1. **Workflow JS は plugin にバンドル不可**: `plugin.json` の Component Path Fields は commands/agents/hooks/mcpServers のみで `workflows` フィールドが存在しない。全 marketplace plugin に `*.workflow.js` は 0 件。
2. **Workflow `scriptPath` は `${CLAUDE_PLUGIN_ROOT}` を展開しない**: docs の適用先は hook command / MCP args / command 本文の `` !` ` `` / `@file` のみ。実機 `wf_*.json` 全件が scriptPath=絶対パスを記録。`name` 形式の global 解決も実証ゼロ（`goal-workflow-integration.md:79-80` が既に「未確認」として scriptPath を採用済み）。→ command .md の scriptPath 絶対パスが**唯一の実証済み経路**。
3. **macOS Darwin 25.5.0 に `/usr/bin/timeout` も `gtimeout` も不在**（実機確認）。hook の `timeout` フィールドは hook script 自体の上限で、codex exec の wall-clock を縛らない。→ perl fork/alarm は「依存追加なしで唯一の wall-clock 有界化手段」。gtimeout 化には `brew install coreutils` が必要。
4. **`hookSpecificOutput.updatedInput` は公式かつ安定**: hook-development SKILL.md に明記、changelog v2.0.10→v2.1.169 で破壊的変更ゼロ（additive のみ）。「version 依存で脆い」は過大評価で、実態は「公式 API として安定だが marketplace 実用例ゼロ」。
5. **settings.json の hook command path では `${CLAUDE_PLUGIN_ROOT}` は空**（plugin context が無い）。
6. **exec.md は veto（編集禁止・狭義=exec.md ファイルのみ）**。CLAUDE.md:36 / goalflow-v4-root-resolution.md:7 / feedback で3重確定。
7. `codex-exec-guard.sh:42` が PreToolUse 公式出力に無い `hookEventName` を出力（ただし discriminated-union のメンバーでもあり、除去が安全とは限らない＝**要実機確認**）。

## 調査結果（goal実態 / 現状実態 / ギャップ）

### goal実態（ユーザが本当に求めていたもの・俯瞰で判明）
「自前スクリプトを公式に差し替えて汎用化」だが、**3層とも既に公式機構の上にある**（slash command / 公式 Workflow ツール / 公式 PreToolUse hook）。つまり「差し替え」の大半は **already-satisfied**。本当の goal は「残るハック（perl・絶対パス・余剰フィールド）の堅牢化と、設計記録の事実整合」に収斂する。

### 現状実態（3層の置換可否）
- **Layer-1 command .md**: frontmatter は公式 primitive を完全活用済み。唯一の非ポータブル点 = 本文の scriptPath 絶対パス。だが前提2より移動不可・現状維持が唯一の実証経路。**A帯では触らない**。
- **Layer-2 workflow JS**: consensus loop / budget / dedup / round 制御は Workflow JS 固有で宣言的 primitive に代替不可（核心は JS 残留が正しい）。probe/critic/verify の prompt 外出しは可能だが、schema/動的プロンプトは JS 残留でプロンプトが分割され、再利用先も現状無く churn リスク。**ユーザ判断で見送り**。
- **Layer-3 hook**: ここに達成可能な磨き込みが集中する。perl→gtimeout 置換（前提3＋ユーザ確定）、出力 JSON の公式準拠確認（前提7）、`updatedInput` 安定性の記録訂正（前提4）。

### ギャップ（goal − 現状 / A帯に限定）
1. **perl ハックの残存**: macOS で動くが「依存なし唯一手段」という消極理由で残っている。ユーザは公式コマンド純度を優先し gtimeout 置換を選択 → coreutils 導入 + timeout/gtimeout ladder へ。
2. **出力フォーマットの非確定**: `hookEventName` が公式 PreToolUse 例に無いが discriminated-union メンバーでもある。どちらが当該版で正かが未確認のまま稼働 → 実機で確認し正しい形へ寄せる。
3. **設計記録の事実誤差**: `goal-exec-codex-large-task-hang.md:116` の「updatedInput は version 依存」は changelog 実績（v2.0.10→v2.1.169 破壊的変更ゼロ）と乖離。perl「公式置換可能」という含意・name 形式の global 解決可否も未記録 → 将来の再調査コストを生む。CLAUDE.md の hook 記述も perl 前提のまま（gtimeout 化で要同期）。

> **plugin 化・workflow 配布・name 形式依存・exec.md 改変は本 plan のスコープ外**（前提1,2,6＋ユーザ判断）。これらは「できない/やらない」と確定記録するのが成果であり、task-3 に含める。

## 実行計画

- [ ] task-1: coreutils 導入（gtimeout を利用可能化）
  - 操作対象: ローカル環境（Homebrew）。`brew install coreutils`。
  - 操作内容: macOS に `gtimeout` を入れる。`which gtimeout` で導入確認。
  - 影響場所と効果: hook が GNU timeout 系コマンドで wall-clock 有界化できるようになる。**ユーザが本 plan で依存追加を事前承認済み**。
  - goalへの影響: ギャップ1 の前提。task-2 の gtimeout 経路を実装可能にする。
  - 備考: ネットワーク/外部操作のため、ユーザが自分のシェルで `! brew install coreutils` を実行してもよい（codex で行う場合は `--sandbox danger-full-access`）。

- [ ] task-2: `codex-exec-guard.sh` を gtimeout 化＋出力の公式準拠確認
  - 操作対象: `~/.claude/hooks/codex-exec-guard.sh`。
  - 操作内容:
    (a) wall-clock 有界化の実装を **timeout/gtimeout ladder** に置換する: PATH に `timeout`（GNU coreutils, Linux 等）があれば `timeout 300 codex exec …`、無ければ `gtimeout 300 codex exec …`（macOS+coreutils）、**どちらも無ければ最終手段として現行 perl fork/alarm にフォールバック**（依存未導入マシンでも fail-open ではなく有界化を保つ＝堅牢性優先）。冪等性（既に timeout/gtimeout/perl で包まれていれば no-op）と既存の前段フィルタ（先頭が `codex exec` のときだけ作用）を維持する。
    (b) 出力 JSON を当該版 v2.1.169 の PreToolUse 仕様に合わせる: `hookSpecificOutput.{permissionDecision:"allow", updatedInput, additionalContext}` を維持。`hookEventName` は **実機 dry-run で除去/保持どちらが正しく解釈されるかを確認し、稼働中の現行形を既定として、確証が取れた場合のみ公式例に合わせる**（憶測除去で regression させない）。`additionalContext` の degrade ladder 文言は perl→gtimeout に合わせて更新。
  - 影響場所と効果: codex exec を発行する全 Bash 呼び出しが、より公式・可読な手段で有界化される。機能（300s 有界化＋回復ガイド）は不変。
  - goalへの影響: ギャップ1,2 を解消。「脆さ・ハック排除」をユーザ確定の射程（gtimeout）で達成。
  - Verification: `bash -n` 構文 / サンプル PreToolUse payload を流して `updatedInput.command` が `gtimeout 300 codex exec …`（または timeout/perl）に包まれた妥当 JSON（`python3 -m json.tool`）/ 冪等性（包み済み→no-op）/ 非 codex Bash→no-op / `gtimeout 2 sleep 5; echo $?`=124 で有界発火 / 通常 codex exec が回帰なく成功。

- [ ] task-3: 設計記録の事実訂正＋スコープ外事項の確定記録
  - 操作対象: `~/.claude/docs/plans/goal-exec-codex-large-task-hang.md`、`~/.claude/CLAUDE.md`（hook 記述節）。
  - 操作内容:
    (1) `updatedInput` は「version 依存で脆い」ではなく「v2.0.10→v2.1.169 で破壊的変更ゼロの安定 API。実用例が少ないのみ」へ訂正（:116 付近および task-2/フォールバック注記）。
    (2) wall-clock 有界化を perl→**timeout/gtimeout ladder（macOS は `brew install coreutils` 必須、無ければ perl フォールバック）** に更新。「perl を公式 primitive に純置換」は macOS では不可（依存追加が要る）と明記。
    (3) **スコープ外の確定事項**を記録: Workflow JS は plugin バンドル不可（plugin.json に workflows フィールド無し）／scriptPath は `${CLAUDE_PLUGIN_ROOT}` 非展開・name 形式 global 解決は実証ゼロ＝scriptPath 絶対パスが唯一の実証経路／settings.json hook では `${CLAUDE_PLUGIN_ROOT}` は空。→ 将来 plugin 化を再検討する際の再調査を防ぐ。
    (4) `CLAUDE.md` の codex-exec-guard 記述を gtimeout ladder に同期（perl 前提の文言を更新）。**exec.md は一切触れない**（veto 尊重）。
  - 影響場所と効果: 同症状・同テーマの再調査コストを消す。flow 正本（CLAUDE.md）が実態と一致する。挙動変更なし（文言のみ）。
  - goalへの影響: ギャップ3 を解消。調査の成果（できない事の確定）を durable 化する。

## 未確定・要判断事項

- **⚖️（低 stakes・実機で閉じる）`hookEventName` の除去/保持**: 公式 PreToolUse 出力例には不在だが discriminated-union メンバーでもある。人間判断ではなく task-2 の dry-run で「どちらが正しく解釈されるか」を確認して閉じる。**確証なき除去はしない**（現行稼働形を既定維持）。
- **⚖️（低 stakes）gtimeout フォールバックに perl を残すか**: 本 plan は「coreutils 未導入でも有界化を失わない」堅牢性を優先し、最終手段として perl を残す ladder を既定とした。もし「ハック完全排除（perl を 1 行も残さない）」を厳密に望むなら、フォールバックを perl ではなく deny+ガイダンス（`brew install coreutils` を促す）に変える選択もある（ただし未導入時は wall-clock 有界化を失う）。既定は ladder（perl 残置）。差し戻し希望があれば task-2 を変更。
- **⚖️（決定済み・記録）plugin 化 / agents 外出し / name 形式 / exec.md 改変はスコープ外**: ユーザ確定で本 plan では行わない。前提1,2,6 により部分的にしか叶わない or 不可。再検討は別 goal で。
- **関連・スコープ外**: 投資調査が再現した「investigate workflow の critic 'high' rubric 過剰発火」（本ランも 5 high gap で 3 round 全消費。実体は同一論点の言い換え＋実機で決着済み）は、本 goal（公式化/ハック排除）とは別件の品質課題。`goalflow-v4-open-threads` memory 管理で、別途扱う。

## PR仕様（PR / スコープごと。/goal:exec はこの仕様どおりに PR 本文を書く）

- PR-1: `~/.claude` リポジトリ — codex-exec-guard の gtimeout 化＋設計記録の事実訂正（A帯磨き込み）
  - 目的: codex exec の wall-clock 有界化を perl ハックから公式コマンド（timeout/gtimeout ladder）へ寄せ、設計記録を調査で確定した事実に整合させる。挙動（300s 有界化＋回復ガイド）は不変のまま堅牢性・可読性・記録の正確性を上げる。
  - 満たすべき要件: A帯（磨き込み）で成功 / perl→gtimeout（coreutils 依存許容）/ exec.md 無編集（veto 尊重）/ plugin 化・workflow 改変はしない。
  - 着手前の立ち位置: hook は macOS 唯一の手段として perl fork/alarm で有界化。出力に余剰 `hookEventName`。設計記録は `updatedInput`「version 依存」・perl「公式置換可能」と不正確で、plugin/scriptPath のできない事が未記録。
  - 完了後の立ち位置: hook は timeout/gtimeout を主経路（perl は最終手段フォールバック）に有界化。出力は当該版仕様に準拠確認済み。設計記録と CLAUDE.md が実態（updatedInput 安定・gtimeout ladder・plugin/scriptPath の制約）と一致。
  - 作業フロー図（mermaid）:
    ```mermaid
    flowchart TD
      A[現状: perl 有界化 + 余剰hookEventName + 記録が不正確] --> B[task-1 brew install coreutils で gtimeout 導入]
      B --> C[task-2 codex-exec-guard.sh: timeout/gtimeout ladder + perl フォールバック + 出力の公式準拠を実機確認]
      C --> D[task-3 設計記録/CLAUDE.md を事実訂正: updatedInput安定 / gtimeout ladder / plugin・scriptPath の制約を確定記録]
      D --> E[完了: 公式コマンドで有界化・記録整合・exec.md 無編集]
    ```
  - 解決タスクと goal への効果: task-1（gtimeout 前提）/ task-2（ハック排除の中核・ギャップ1,2）/ task-3（記録整合・ギャップ3）。→ A帯の達成可能フロンティアを満たす。
  - PR外への影響: グローバル `~/.claude/hooks/codex-exec-guard.sh` は全 session の `Bash(codex exec)` に作用（意図どおり・挙動不変）。`brew install coreutils` はローカル環境に gtimeout を追加（ユーザ承認済み）。settings.json の hook 登録（絶対パス）は変更しない。exec.md / workflow JS / plugin は無編集。
  - Verification: 本 repo に共通 build/test 無し → **手レビュー + 手動 dry-run**。(1) `which gtimeout` 成功。(2) `bash -n ~/.claude/hooks/codex-exec-guard.sh`。(3) サンプル codex exec payload を hook に流し `updatedInput.command` が `gtimeout 300 codex exec …` に包まれた妥当 JSON（`python3 -m json.tool`）・冪等（包み済み→no-op）・非 codex→no-op。(4) `gtimeout 2 sleep 5; echo $?` = 124。(5) 通常 codex exec が回帰なく成功。→ いずれか失敗時は task-2 へ差し戻し。
  - その他共有事項: `hookEventName` は実機 dry-run で確証が取れた場合のみ除去（現行稼働形が既定）。フォールバックの perl 残置は堅牢性優先の既定（厳密排除を望む場合のみ未確定事項の代替へ差し戻し）。

---
plan.md を確認・編集のうえ /goal:exec を実行してください。
