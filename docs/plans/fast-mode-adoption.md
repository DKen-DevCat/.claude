# Goal: 高速化設定の導入PR生成（Claude=Opus4.8+/fast、Codex=xhigh+priority処理枠、切り戻し可能）

> 出力ファイル名: `/goal:plan` テンプレートは引数全文を展開し不正名になるため、確立済み slug `docs/plans/fast-mode-adoption.md` を採用（検討版を、ユーザ決定＋実機/公式確認を反映した**確定実装計画**へ更新）。
>
> 調査状況: goal/現状実態は前段の調査 Workflow + deep-research で確定済みのため Workflow は再起動せず計画化に集中。**残課題だった Codex の service_tier 設定法も確定**（公式 Config Reference + `openai/codex` PR #21697 + 実機 `codex exec --help`）。**未検証ゼロで実装可能**。

---

## 背景（なぜ / 要件 / 前提）

### なぜ
余剰予算（usage credit 等）を**速度＝開発スループット**へ転用したい。**品質は落とさず処理だけ高速化**する方針。

### 要件（ユーザ確定）
- **R1**: Claude Code は **Opus 4.8** で **`/fast`** を使用。
- **R2**: Codex は**常に高速モード**で運用 = **`service_tier = "priority"`（優先処理枠）**。
- **R3**: Codex は **`xhigh`** で運用 = **`reasoning_effort = "xhigh"` 維持**。
  - R2+R3 = ユーザの言う「**xhigh の fast モード**」（深度は最大のまま、処理枠を priority にして高速化）。
- **R4**: 他の設定は**既存を踏襲**（最小差分）。
- **R5（新規）**: 運用後にユーザ判断で**構成を切り戻せる（rollback 可能）環境**にする。
- **Goal**: 上記 R1–R5 を満たす **PR が生成されていること**。

### 前提（公式・実機で確定済み）
- **Claude `/fast`**: 同一 Opus（小型モデル切替なし）・**品質不変(identical quality)**・出力最大2.5倍速・**per-token 割増コストで usage credit を直接消費**・**main セッションのみ（sub-agent/sonnet workflow 非波及）**・**常時化は `settings.json "fastMode": true`**・mid-session 切替は全文脈再課金ゆえ session 開始から有効化。Opus 4.8/4.7/4.6 のみ。無効化は `CLAUDE_CODE_DISABLE_FAST_MODE=1`。
- **Codex 高速モード = `service_tier="priority"`**（OpenAI API の優先処理枠）。**同一モデル・同一品質で処理を高速化・割増課金**（Claude /fast と同型）。`reasoning_effort="xhigh"` と**併用可**。⚠️制約: priority は **long context 非対応扱い**・**xhigh 自体が重い**ため「最速」ではない（=「xhigh の高速枠」）。ユーザ認識と一致。
- **Codex の service_tier 設定法（確定）**: config キーは **`service_tier`**（トップレベル）。値 `default`/`priority`/`flex`（legacy `fast`→`priority`）。設定法は (a) `~/.codex/config.toml` 直書き、(b) `[profiles.*]`、(c) **`codex exec -c service_tier="priority"`**。当環境の `codex exec` に `--service-tier` 専用フラグは**無い**ため **(c) `-c` を使用**し、`--strict-config` でキー受理を確認可。`-c model_reasoning_effort="xhigh"` も同様に付与可（現値と同一）。
  - 出典: developers.openai.com/codex/config-reference, github.com/openai/codex PR #21697・core/config.schema.json, 実機 `codex exec --help`。
- **リポジトリ境界（R5 に直結）**: **`~/.claude` は git 管理**（PR 単位で `git revert` 可能＝rollback 主機構）。**`~/.codex` は当該リポジトリ外**（git 非追跡。`config.toml.bak` 手動運用あり）。→ Codex 設定は **`~/.codex/config.toml` ではなく `~/.claude` の exec.md に `-c` で埋め込む**ことで、全変更を単一 git PR に閉じて revert 可能にする。
- 現状値: `settings.json` に `fastMode`/`model` キーなし（現行 Opus 4.8 稼働、コマンド frontmatter `model: claude-opus-4-8`）。`~/.codex/config.toml` は `model=gpt-5.5`/`model_reasoning_effort=xhigh`、`service_tier` なし。`exec.md:23` は `codex exec --model gpt-5.5 --sandbox workspace-write \`（reasoning/service_tier 非明示＝config 依存）。`CLAUDE.md:19`/`README.md:74` に「xhigh」表記。

---

## 調査結果（goal実態 / 現状実態 / ギャップ）

### goal 実態
高速化は**二系統・同型**: Claude=`/fast`、Codex=`service_tier:priority`。いずれも「同一モデル・同一品質・割増コストで処理高速化」。Codex は depth=xhigh を維持（=「xhigh の fast」）。

### 現状実態（該当箇所・行番号付き）
| 対象 | 現状 | 変更 |
|---|---|---|
| `~/.claude/settings.json` | `fastMode` なし / `model` キーなし | **追加**: `"fastMode": true`（R1）。`model` 明示は任意(未確定#3) |
| `~/.claude/commands/goal/exec.md:23` | `codex exec --model gpt-5.5 --sandbox workspace-write \` | **更新**: `codex exec --model gpt-5.5 -c model_reasoning_effort="xhigh" -c service_tier="priority" --sandbox workspace-write \`（R2/R3、git 追跡内に閉じる） |
| `~/.codex/config.toml` | `model_reasoning_effort=xhigh`、`service_tier` なし | **据置**（R4 既存踏襲＋git 外で復旧困難なため触らない） |
| `~/.claude/CLAUDE.md:19` | 「Codex(gpt-5.5 / xhigh)」 | **追記**: 高速化方針（Claude=/fast(Opus4.8)、Codex=xhigh+priority、品質維持・割増コスト） |
| `~/.claude/README.md:74` | 「Codex（gpt-5.5/xhigh）」 | **任意追記**: priority 運用の脚注（xhigh 表記自体は維持） |
| workflow の sonnet agent | `model:'sonnet'` | 対象外（/fast は Opus 専用・非波及） |

### ギャップ（goal − 現状 → 充足策）
- **G1 (R1)**: `/fast` 未設定 → `settings.json "fastMode": true`。
- **G2 (R2)**: Codex priority 未設定 → `exec.md:23` に `-c service_tier="priority"`（キー確定済み）。
- **G3 (R3)**: xhigh は既存維持 → `exec.md:23` に `-c model_reasoning_effort="xhigh"` を明示（config 依存を断ち「常に xhigh」を保証。値は現状と同一＝実質既存踏襲）。
- **G4 (R5)**: ロールバック機構 → **全変更を `~/.claude` の単一 PR に集約**（settings.json + exec.md + CLAUDE.md + notes）し `git revert` で一括復旧。`~/.codex` 不変。手順を `docs/notes/` に文書化。
- **G5 (R4)**: 既存踏襲 → `~/.codex/config.toml` 本体・他キー無変更。追加は最小（fastMode 1行 + exec.md の `-c` 2フラグ + 方針/手順文書）。

---

## 実行計画

> 全タスクは同一ブランチ＝単一 PR。task-1 着手時に `codex exec --strict-config -c service_tier="priority" -c model_reasoning_effort="xhigh"` を no-op 的に1回試し、キー受理だけ確認してから編集する（軽い保険）。

- [ ] **task-1: Claude Code `/fast` 常時有効化（R1）**
  - 操作対象: `~/.claude/settings.json`
  - 操作内容: トップレベルに `"fastMode": true` を追加（session 開始から有効化＝mid-session 再課金回避）。現行モデルは Opus 4.8 のため要件充足。`"model": "claude-opus-4-8"` 明示は任意（未確定#3）。
  - 影響場所と効果: 全 Claude Code セッション（plan/exec の Opus）が高速化・品質不変。sub-agent/sonnet workflow 非波及。
  - goalへの影響: R1 を公式の確定手段で充足。

- [ ] **task-2: Codex を「xhigh + priority」化（R2/R3）— exec.md に `-c` で付与**
  - 操作対象: `~/.claude/commands/goal/exec.md:23`
  - 操作内容: codex 呼び出しを `codex exec --model gpt-5.5 -c model_reasoning_effort="xhigh" -c service_tier="priority" --sandbox workspace-write \` に更新。`service_tier` は確定キー（priority=優先処理枠）。`~/.codex/config.toml` は変更しない。
  - 影響場所と効果: フロー内の全 Codex 実装呼び出しが「xhigh + priority」で稼働。変更は git 追跡内（exec.md）に閉じ `~/.codex` 不変（R4・ロールバック容易）。
  - goalへの影響: R2（priority 高速モード）+ R3（xhigh 維持）を同時充足。

- [ ] **task-3: 高速化方針を CLAUDE.md / README に明文化（R1–R4 の記録）**
  - 操作対象: `~/.claude/CLAUDE.md`（モデル方針 or 新節）、`~/.claude/README.md:74`（任意）
  - 操作内容: 「Claude=Opus4.8+/fast、Codex=xhigh+priority処理枠。いずれも同一品質・割増コストで処理高速化し、余剰予算を速度へ転用。`~/.codex/config.toml` 本体は据置（既存踏襲）」を記載。/fast の sub-agent 非波及・無効化手段（`CLAUDE_CODE_DISABLE_FAST_MODE=1`）、priority の long-context 非対応も付記。
  - 影響場所と効果: 正本に方針・運用根拠を記録。
  - goalへの影響: R4（方針の既存踏襲明記）と運用周知。

- [ ] **task-4: 切り戻し（rollback）手順の整備（R5）**
  - 操作対象: 新規 `~/.claude/docs/notes/fast-mode-rollback.md`
  - 操作内容: 手順を文書化 — ①`git revert <本PRのmerge commit>`（settings.json/exec.md/CLAUDE.md を一括復旧）、②個別無効化（`settings.json` から `fastMode` 削除 or `CLAUDE_CODE_DISABLE_FAST_MODE=1`、exec.md から `-c service_tier=...`/`-c model_reasoning_effort=...` を除去）。`~/.codex` は不変のため復旧不要。
  - 影響場所と効果: ユーザが任意のタイミングで構成を確実に戻せる。
  - goalへの影響: R5 を充足。

---

## 未確定・要判断事項

1. **Codex priority の適用「範囲」（R2 の "常に"）**: フロー内 codex（exec.md の `-c`）に限定＝**git 追跡・ロールバック容易（推奨）** vs グローバル `~/.codex/config.toml` に `service_tier="priority"`＝全 codex 用途で常時 priority だが git 外で復旧困難・全 PJ で割増課金。「他設定既存踏襲」「切り戻し可能」を重視し前者を既定とした。全 codex 一律 priority を望むなら後者（その場合 `config.toml.bak` 退避＋復元手順を task-4 に追加）。
2. **`/fast` 適用範囲**: `~/.claude/settings.json "fastMode": true` は**全 Claude Code 作業に波及**（goal フロー外含む）。R1 は一般要件のため global で素直だが、全 PJ で credit 消費が速まる点は周知。
3. **`settings.json` への `model` 明示**: 現状コマンド frontmatter が Opus 4.8 を指定済み。`"model":"claude-opus-4-8"` を settings に足すと R1 の「Opus4.8」をより堅く保証できるが「既存踏襲」とのバランスで任意。
4. **long context での priority 挙動**: priority は long context 非対応のため、長文脈タスクで自動フォールバック（default 扱い）になる挙動を運用上許容するか確認。

---

## PR仕様（PR / スコープごと。/goal:exec はこの仕様どおりに PR 本文を書く）

> R5（切り戻し）を満たすため、**全変更を `~/.claude` の単一ブランチ＝単一 PR** に集約し、`git revert` 一発でロールバックできる単位にする。`~/.codex` は触らない。

- **PR-1: `~/.claude` — 高速化設定の導入（Claude /fast + Codex xhigh+priority、切り戻し可能）**
  - 目的: R1–R5 を満たす構成変更を 1 つの revertable な PR として作る。
  - 満たすべき要件: R1(Claude Opus4.8+/fast) / R2(Codex priority) / R3(Codex xhigh 維持) / R4(他設定既存踏襲) / R5(git revert でロールバック可能)。
  - 着手前の立ち位置: `fastMode` 未設定、exec.md は service_tier/reasoning 非明示（config 依存）、高速化方針・ロールバック手順なし。
  - 完了後の立ち位置: `settings.json "fastMode": true`、`exec.md:23` が `--model gpt-5.5 -c model_reasoning_effort="xhigh" -c service_tier="priority"`、CLAUDE.md に方針、`docs/notes/fast-mode-rollback.md` に復旧手順。`~/.codex` 不変。`git revert` で全戻し可能。
  - 作業フロー図（mermaid）:
    ```mermaid
    flowchart TD
      A[着手前: 高速化なし・fastMode未設定] --> B["task-1: settings.json fastMode:true"]
      B --> C["task-2: exec.md:23 に -c model_reasoning_effort=xhigh / -c service_tier=priority<br/>(--strict-config で受理確認)"]
      C --> D[task-3: CLAUDE.md/README に方針明文化]
      D --> E[task-4: docs/notes/fast-mode-rollback.md 整備]
      E --> F[完了: 単一PR=git revert で一括ロールバック可能]
    ```
  - 解決タスクと goal への効果: task-1(R1), task-2(R2/R3), task-3(R4 記録), task-4(R5)。単一 PR 集約で Goal「要件充足 PR の生成」と R5「切り戻し可能」を同時達成。
  - PR外への影響: ⚠️ `~/.claude/settings.json` はユーザ global のため **`fastMode:true` は全 Claude Code セッション/全 PJ に波及**（usage credit 消費が速くなる。破壊的でないが周知必須）。Codex 設定は exec.md の `-c` に限定したため **他 codex 用途・他 PJ への影響なし**（`~/.codex/config.toml` 不変）。sub-agent/sonnet workflow へは非波及。
  - その他共有事項: `/fast`・priority とも**品質は不変**（速度/コストのトレードオフのみ）。コストは両者とも割増（credit 直接消費）。priority は long context 非対応・xhigh は重く「最速」ではない（=xhigh の高速枠）。`service_tier` キーは確定済み（公式 Config Reference / PR #21697）だが、念のため task-2 着手時に `--strict-config` で受理を1回確認。

---

### 出典・確度
- Claude `/fast`: 公式 code.claude.com/docs（fast-mode/settings/commands/sub-agents）で**確定**。
- Codex priority/xhigh: OpenAI 公式（developers.openai.com の Codex config-reference / gpt-5.5 guide）＋ `github.com/openai/codex` PR #21697・config.schema.json ＋ 実機 `codex exec --help` で**確定**（config キー=`service_tier`、値 `priority`、`-c` 上書き可、`--service-tier` 専用フラグは当環境に無し）。
- 設計（二系統・同型の品質維持型高速化／Codex 設定は exec.md の `-c` に閉じ単一 PR で `git revert` 可能）は**確定**。未検証要素なし（適用範囲のみ方針判断＝未確定#1–#4）。
