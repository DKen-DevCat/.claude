# Goal: /goal:exec で codex に大タスクを渡すと「無限待ち/Bash が返らない」true hang になる根本原因を突き止め、恒久対策（PreToolUse hook による codex 呼び出し堅牢化）まで設計する

> 出力先メモ: コマンド指定の literal filename は `:` `。` とタイポ(sessionn)を含むため、
> CLAUDE.md の `<goal-slug>` 規約に従い `docs/plans/goal-exec-codex-large-task-hang.md` に正規化した。

## 背景（なぜ / 要件 / 前提）

**なぜ**: `/goal:exec` は Codex 実装委譲の中核。大タスクで codex が *true hang*（Bash ツールが返らず無限待ち）すると、パイプライン全体がデッドロックする。複数 session で再現しており、goalflow v4 の信頼性を損なう実用上のブロッカー。

**要件（intake 確定）**:
1. 再現条件を言語化する（何が hang を引き起こすか）。
2. *true hang*（= Bash が返らない。単に遅いだけなら Bash 既定 timeout で error 終了するはず）を機構レベルで説明できる根本原因を特定する。
3. **恒久対策まで**設計する（診断のみで止めない＝intake で「診断＋恒久対策まで」を選択）。
4. 恒久対策は **Claude Code の hook を使う**（ユーザ指示。当初候補の exec.md 直接編集ではなく）。
5. 既存 exec.md 契約（1タスク=1 codex / top-level 同期 / xhigh / service_tier=priority / -o .codex-out / --sandbox workspace-write）の意図を壊さない。
6. `exec.md` 本体は編集しない（`feedback_goal_exec_loop.md` の veto を尊重。hook は exec.md を触らずに堅牢化を達成できる）。

**前提（investigation で実ファイル確認済み）**:
- codex 呼び出し: `commands/goal/exec.md:23-25` の `codex exec --model gpt-5.5 -c model_reasoning_effort="xhigh" -c service_tier="priority" --sandbox workspace-write -o .codex-out/<id>.md "<inline 4項目指示>"` を Bash ツール経由 top-level 同期で実行。**明示 timeout なし**。
- codex-cli 0.134.0。`codex exec` に `--timeout` フラグは無い。
- `~/.codex/config.toml`: model_reasoning_effort=xhigh / approval_policy=never(TTY 無し) / sandbox_mode=workspace-write。
- Claude Code v2.1.169。`settings.json`: `permissions.allow=[Bash(*)]` / `defaultMode=acceptEdits` / `effortLevel=xhigh`。**hook は未登録**。
- 一次証拠 memory `feedback_codex_ratelimit_hang.md`（実測・切り分け済み）。

## 調査結果（goal実態 / 現状実態 / ギャップ）

### goal実態（あるべき姿）
codex exec が rate-limit 等で応答不能になっても、Bash 呼び出しは**有界時間で必ず返り**、orchestrator が「ハングを検知 → degrade（effort 低下 / チャンク化 / priority 除去）して回復」できる。これが全 session で**強制**される（人手・prose 依存で「忘れる」ことがない）。

### 現状実態（root cause 確定）
`feedback_codex_ratelimit_hang.md` の実測 + investigation の照合で、root cause は**確定**：

- **機構**: hang は常に**最初の API リクエスト段**（ファイル読込前）で発生。`model_reasoning_effort="xhigh"` が予約する巨大トークン量 × 累積 TPM/RPM レート制限の枯渇 → **429** → codex が**沈黙の指数バックオフ**で再試行 → stdout ゼロのまま Bash が返らない = true hang。
- **「大タスク」の正体（intake で未確認だった軸の解明）**: プロンプト文字列長ではない。大タスク = ファイル数大 = 予約トークン大 → TPM 上限に早く到達。加えてセッション後半（経験則 ~15 呼び出し以降）に累積枯渇。
- **除外済み（実測）**: contention ではない（競合 session を止めても hang）/ priority 枠固有ではない（service_tier を外しても hang）/ shell quoting 破綻(A)・stdin ブロック(B) は現行 Claude Code Bash 経由では主因でない（全 stdout ログで `<stdin>` ブロック未出現 = inline arg で intact 到達）。小 call・低 effort（PONG / 2 ファイルチャンク）は throttle 下でも**通る**。~4.5 分クールダウンでは大 xhigh は回復しない。
- **増幅要因**: exec.md は Bash 呼び出しに明示 timeout を渡さない。Bash ツールの実効上限は v2.1.110 で最大 600000ms(10分)。8 分 hang はユーザが 10 分上限到達前に手動停止したと整合 → 「timeout が全く無い」ではなく「**10 分は実用上ほぼ無限 hang に見える**」。

### ギャップ（goal − 現状）
1. **有界化の欠如**: codex exec の待ちに短い明示上限が無い → 沈黙のまま最大 10 分（旧版は実質無制限）。
2. **回復手順の非強制**: degrade ladder（effort 低下 / チャンク / priority 除去）が実測 memory にあるが、どの呼び出し経路にも組み込まれていない。
3. **全 session への一括適用手段の欠如**: exec.md / exec-v4.md / parallel-loop exec.md の 3 ファイルが同一脆弱テンプレートを持ち、ファイル単位の修正では漏れる。「他 session でも発生」を一撃で塞ぐ中央点が無い。
4. **hook 機構の実装前提の未確定（empirical）**: PreToolUse の command 書き換え可否・rewrite 後コマンドの権限再評価は実機確認が要る（後述 ⚖️/検証）。

### hook が root cause に効く理路
hook は **rate-limit そのものを消せない**（OpenAI アカウント側制約）。狙いは「**沈黙の無限 hang → 有界 fail-fast + 回復ガイド**」への置換。`PreToolUse` で codex exec を wall-clock wrapper で包む（hook は Bash の timeout_ms を直接設定できないため、GNU `timeout`/`gtimeout` を優先し、macOS でそれらが無い場合のみ `perl` fork/alarm にフォールバックする ladder）と、429 バックオフ中でも N 秒で wrapper が codex を kill → Bash は exit 124 で必ず返る → orchestrator が degrade ladder（hook が `additionalContext` で注入）で回復できる。現状は coreutils 導入済みのため GNU `timeout`/`gtimeout` 優先。`perl` fallback を GNU `timeout`/`gtimeout` に純置換する場合、macOS では coreutils（`gtimeout`）という依存追加を伴う（現環境は導入済み）。グローバル登録なら全 session に強制適用される。

## 実行計画

- [ ] task-1: root cause を durable artifact として確定記録
  - 操作対象: `~/.claude/projects/-Users-ooizumiyou-nestify/memory/feedback_codex_ratelimit_hang.md`（および必要なら `~/.claude/projects/.../memory/` のグローバル該当ファイル）
  - 操作内容: 「root cause 確定（最初の API リクエスト段の xhigh 巨大予約 × TPM/RPM 枯渇 → 429 → silent backoff → true hang）」「canonical fix = グローバル PreToolUse hook による timeout 有界化 + degrade ガイド注入」を追記。investigation の除外結果（quoting/stdin/contention/priority 非該当）も確定として明記。
  - 影響場所と効果: 次 session 以降、同症状の再調査コストを消す。診断成果物として残る。
  - goalへの影響: 要件(2)(3)の「原因特定＋恒久知識化」を満たす。

- [ ] task-2: PreToolUse hook スクリプトを作成（core fix）
  - 操作対象: 新規 `~/.claude/hooks/codex-exec-guard.sh`（実行権限付与）
  - 操作内容: stdin から hook payload(JSON) を受け、`tool_name=="Bash"` かつ `tool_input.command` が `codex exec` を含み、かつ既に wall-clock wrapper で包まれていない場合に、(a) command を GNU `timeout`/`gtimeout` 優先・無い場合のみ `perl` fork/alarm fallback の 300s wrapper 付き `codex exec` に rewrite して `hookSpecificOutput.updatedInput.command` で返す、(b) `additionalContext` に degrade ladder（exit 124/レート枯渇時: effort xhigh→high→medium / 2-3 ファイルにチャンク / `-c service_tier="priority"` 除去 / 最終手段 Opus 直接）を載せる、(c) `permissionDecision:"allow"` で通す。該当しない Bash はそのまま allow（no-op）。`hookSpecificOutput.updatedInput` は v2.0.10 初導入以降 v2.1.169 まで rename / 削除 / deprecated なし・変更は additive のみで、version 安定な公式 API。リスクの実態は version 不安定ではなく公式サンプルでの実用例が少ない点なので、task-4 では未サポート分岐ではなく rewrite 発火を確認する。冪等性（二重 wrapper 付与回避）と JSON 妥当性を必須にする。
  - 影響場所と効果: codex exec を発行する全 Bash 呼び出しが、実行直前に有界化される。orchestrator の作文に依存しない harness 強制。
  - goalへの影響: ギャップ(1)(2) を直接解消。true hang を 5 分有界 fail に置換し回復経路を与える。

- [ ] task-3: hook をグローバル settings.json に登録（core fix）
  - 操作対象: `~/.claude/settings.json`（`hooks.PreToolUse` を新設）
  - 操作内容: `{"matcher":"Bash", "if":"Bash(codex exec *)", "hooks":[{"type":"command","command":"<abs path>/codex-exec-guard.sh","timeout":30}]}` を追加。`if` フィールドの版互換が不確実な場合は matcher のみ("Bash")にしスクリプト内で command 内容判定（task-4 で確定）。hook 自体の `timeout` は短く（例 30s。hook 内で PONG 等を呼ばない HD1 では rewrite は瞬時なので十分）。
  - 影響場所と効果: **全 session・全プロジェクト**の codex exec に適用（要件「他 session でも発生」を一括で塞ぐ）。exec.md / exec-v4.md / parallel-loop exec.md の 3 ファイルを個別修正せずカバー。
  - goalへの影響: ギャップ(3) を解消。veto 対象の exec.md を無編集のまま堅牢化（要件(6)）。

- [ ] task-4: 実機検証（hook の前提と効果を確定）
  - 操作対象: インストール済み Claude Code v2.1.169 の hooks 挙動 / `~/.claude/hooks/codex-exec-guard.sh` / 実 codex exec
  - 操作内容: (a) `hookSpecificOutput.updatedInput` サポートは v2.0.10 以降 169 version の実績で安定と確認済みなので、当該版でのフィールド名再確認ではなく、`if` フィールド対応と実行環境での rewrite 発火を確認。(b) サンプル payload を `echo | codex-exec-guard.sh` に流し、GNU `timeout`/`gtimeout` 優先・無い場合のみ `perl` fork/alarm fallback の 300s wrapper を含む妥当 JSON が出ることを確認。(c) 実 codex exec を 1 回発行し、transcript 上で**実際に実行されたコマンドが wrapper 付きに書き換わっている**ことを確認（rewrite 後コマンドが skill allowed-tools/グローバル Bash(*) の下で実行可能なことも併せて確認）。(d) 可能なら throttle 後/大 xhigh 呼び出しが ~300s exit124 で返り、無限 hang しないことを確認（throttle 強制が困難なら「N 秒 sleep する擬似 codex」で timeout 発火だけ確認）。(e) 通常の codex exec が end-to-end で成功することを確認（回帰なし）。
  - 影響場所と効果: hook の唯一の load-bearing 前提（command rewrite の実環境での発火）と回帰有無を確定。
  - goalへの影響: 恒久対策が「設計だけ」で終わらず実効を持つことを保証。要件(2)(3)の検証部。

- [ ] task-5（任意・Tier-2 prevention）: レート予算トラッカーを hook に追加
  - 操作対象: `~/.claude/hooks/codex-exec-guard.sh`（state ファイル例 `~/.codex/.goalflow-rate-state.json`）
  - 操作内容: session 内の codex exec 呼び出し回数/時刻を記録し、閾値（実測 ~15 回 / 直近の連続大 xhigh）超過時に rewrite で effort を high へ予防的に下げる、または `additionalContext` で警告。PONG 疎通は**採用しない**（memory 実測で throttle 下でも PONG は通り、本 failure mode を検知できないため＝no silent value）。
  - 影響場所と効果: hang を起こす前に throttle 到達を予防（HD1 の有界化 = 事後回復に対し、事前予防の多重防御）。
  - goalへの影響: 再発頻度自体を下げる。core(PR-1)の効果が確認できてから着手。

- [ ] task-6: hook の存在を flow 正本に明文化（discoverability）
  - 操作対象: `~/.claude/CLAUDE.md`（plan-exec 契約 付近に短い節）
  - 操作内容: 「codex exec は PreToolUse hook `codex-exec-guard.sh` により timeout 有界化され、ハング時は degrade ladder に従う」旨を 2-4 行で記載。exec.md 本体は触らない（veto 尊重）。
  - 影響場所と効果: hook の「暗黙の書き換え」を将来の自分/別 session が発見できる。CLAUDE.md は flow 変更の唯一反映点であり適切な置き場所。
  - goalへの影響: 恒久対策の保守性・透明性。exec.md veto と両立。

## 未確定・要判断事項

- **⚖️ scope（決定済み・記録）**: 変更対象は hook（ユーザ指示）。req5 当初案の exec.md 直接編集は**不採用**。これにより `feedback_goal_exec_loop.md` の exec.md 編集 veto と衝突しない。exec.md / exec-v4.md / parallel-loop の 3 ファイルはグローバル hook で一括カバーするため、個別修正は不要。
- **⚖️ 検証依存の前提（task-4 で実行環境上の発火を確認）**:
  - PreToolUse の command rewrite（`hookSpecificOutput.updatedInput.command`）は v2.0.10 初導入以降 v2.1.169 まで破壊的変更ゼロ（rename / 削除 / deprecated なし、変更は additive のみ）の version 安定な公式 API。残リスクは version 不安定ではなく公式サンプルでの実用例が少ない点なので、task-4 ではサポート有無ではなく rewrite 発火を目視確認する。
  - rewrite 後の wrapper 付き `codex exec`（GNU `timeout`/`gtimeout` 優先、無い場合のみ `perl` fork/alarm fallback）が exec.md skill の allowed-tools whitelist 下で実行可能か。グローバル `Bash(*)`+`acceptEdits` で通る公算が高いが、whitelist が hard capability 制限なら該当 frontmatter に wrapper command の追記が要る。task-4(c) で確認。
- **⚖️ tunable（既定値・要に応じ調整）**: timeout 上限 `N`。既定 300s（Bash 600s 上限内・~4.5 分クールダウンより長く、無限 hang よりは十分短い）。hook 自体の timeout=30s。これらは低 stakes、実運用で調整可。
- **⚖️ Tier-2 の採否（任意）**: task-5 レート予算トラッカーは core(PR-1)効果確認後に判断。不要なら PR-1 のみで完結。
- **注記（正直な限界）**: hook は rate-limit を**解消しない**。大 xhigh を throttle 下で成功させるのは degrade（チャンク/effort 低下/priority 除去）であり、hook はそれを「沈黙 hang」ではなく「有界 fail + ガイド」に変えて**回復可能にする**もの。`-c service_tier="priority"` は exec.md 既定のままだが、degrade ladder で除去対象に含めている（exec.md の既定値変更は本 plan では行わない）。
- **関連確定事項（将来 plugin 化を再検討する場合）**: 詳細は `docs/plans/goalflow-scripts-officialize.md` を参照。要点は以下。
  - Workflow JS は plugin にバンドル不可（`plugin.json` に `workflows` フィールドが無い）。
  - Workflow の `scriptPath` は `CLAUDE_PLUGIN_ROOT` を展開しない。`name` 形式の global 解決は実証ゼロなので、`scriptPath` 絶対パスが唯一の実証済み参照方式。
  - `settings.json` の hook command では `CLAUDE_PLUGIN_ROOT` は空（plugin context が無い）。
- **関連 open threads**: v4 ブランチ（controller / parallel-loop / claude-md）の canonical 化は本 hang fix とは別件（`goalflow-v4-open-threads` memory 管理）。本 plan はそれに依存せず単独で完結する。

## PR仕様（PR / スコープごと。/goal:exec はこの仕様どおりに PR 本文を書く）

- PR-1: `~/.claude` リポジトリ — codex-exec hang guard（グローバル PreToolUse hook）＋診断記録＋doc
  - 目的: codex exec の true hang を、全 session で**有界 fail-fast + degrade ガイド**に置換する恒久対策を、exec.md を無編集（veto 尊重）で導入する。
  - 満たすべき要件: 要件 1-6 すべて。特に「true hang の解消（有界化）」「全 session 適用」「exec.md 無編集」「root cause の知識化」。
  - 着手前の立ち位置: codex exec は明示 timeout なし → 429 silent backoff で最大 10 分（旧版実質無制限）の沈黙 hang。回復手順は memory に散在し非強制。
  - 完了後の立ち位置: グローバル PreToolUse hook が codex exec を実行直前に GNU `timeout`/`gtimeout` 優先・無い場合のみ `perl` fork/alarm fallback の 300s wrapper へ rewrite し、`additionalContext` で degrade ladder を注入。Bash は必ず有界で返り、orchestrator が回復可能。root cause は memory に確定記録、hook の存在は CLAUDE.md に明文化。
  - 作業フロー図（mermaid）:
    ```mermaid
    flowchart TD
      A[現状: codex exec 明示timeoutなし→429 silent backoff→無限hang] --> B[task-1 root cause を memory に確定記録]
      B --> C[task-2 codex-exec-guard.sh 作成: timeout/gtimeout優先 + perl fallback rewrite + degrade ladder 注入]
      C --> D[task-3 settings.json hooks.PreToolUse にグローバル登録]
      D --> E[task-4 実機検証: rewrite発火 / 有界fail / 回帰なし を確認]
      E --> F[task-6 CLAUDE.md に hook の存在を明文化]
      F --> G[完了: 全session で codex exec が有界化・回復可能・exec.md 無編集]
    ```
  - 解決タスクと goal への効果: task-1（診断確定）/ task-2,3（core fix=有界化+全session適用）/ task-4（実効検証）/ task-6（透明性）。→ ギャップ 1,2,3 を解消し goal を達成。
  - PR外への影響: グローバル `settings.json` への hook 追加は**全プロジェクト・全 session の Bash(codex exec) 呼び出し**に作用（意図どおり）。codex exec 以外の Bash は no-op。exec.md / exec-v4.md / parallel-loop exec.md は無編集のまま挙動だけ堅牢化される。
  - Verification: 本 repo に共通 build/test は無し → **手レビュー + 手動 dry-run**。具体: (1) `python3 -m json.tool < ~/.claude/settings.json`（JSON 妥当）。(2) `echo '<sample Bash codex exec payload>' | ~/.claude/hooks/codex-exec-guard.sh` が `hookSpecificOutput.updatedInput.command` に GNU `timeout`/`gtimeout` 優先・無い場合のみ `perl` fork/alarm fallback の 300s wrapper を含む妥当 JSON を返す（冪等性: 既に wrapper 付きなら no-op）。(3) 実 codex exec を 1 回流し、transcript で実行コマンドが wrapper 付きに書き換わり、通常タスクが成功（回帰なし）。(4) 擬似ハング（sleep する偽 codex 等）で ~300s exit124 returns を確認。→ いずれか失敗時は hook 設定/実装を修正する。
  - その他共有事項: `hookSpecificOutput.updatedInput` のフィールド名は version 依存ではない。v2.0.10 初導入以降 v2.1.169 まで rename / 削除 / deprecated なし・変更は additive のみで、version 安定な公式 API。リスクは公式サンプルでの実用例が少ない点に限られるため、検証で必ず rewrite 発火を目視確認する。

- PR-2（任意・後続）: `~/.claude` リポジトリ — codex レート予算トラッカー（Tier-2 prevention）
  - 目的: hang を起こす前に throttle 到達を予防（事後回復に対する事前予防の多重防御）。
  - 満たすべき要件: 要件(3)の予防強化。core(PR-1)の効果確認が前提。
  - 着手前の立ち位置: PR-1 で有界 fail-fast + degrade は効くが、throttle 到達自体は防げない。
  - 完了後の立ち位置: hook が session 内 codex 呼び出しを計数し、閾値超過で effort を予防的に下げる/警告。
  - 作業フロー図（mermaid）:
    ```mermaid
    flowchart TD
      A[PR-1 完了: 有界fail-fast + degrade] --> B[task-5 hook に rate-budget state 追加]
      B --> C[閾値~15回/連続大xhigh で effort予防降下 or 警告]
      C --> D[完了: throttle 到達頻度を低減]
    ```
  - 解決タスクと goal への効果: task-5。→ 再発頻度を下げ goal の持続性を高める。
  - PR外への影響: state ファイル（`~/.codex/.goalflow-rate-state.json` 等）を新規生成。codex exec 挙動を effort 面で自動調整するため、意図せぬ effort 低下が無いよう閾値は保守的に。
  - Verification: 手レビュー + dry-run（閾値未満では no-op、超過で rewrite に effort 降下が入ることをサンプル payload で確認）。PONG 疎通は不採用（memory 実測で本 failure mode を検知できないため）。
  - その他共有事項: PR-1 の効果が実運用で確認できるまで着手しない（不要なら本 PR は破棄可）。

---
plan.md を確認・編集のうえ /goal:exec を実行してください。
