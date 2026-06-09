# Goal: verify workflow の side-effects false positive を解消する

`goal-exec-verify.workflow.js` の side-effects 逆検証が、pre-existing/未コミット差分を当該 task の副作用と誤検知する false positive を解消する。verifier が「当該 task 由来の差分だけ」を評価できるようにする。

## 背景（なぜ / 要件 / 前提）

**なぜ**: v4 exec 実行中、side-effects レンズが settings.json（pre-existing・mtime 6/3）を2回、exec.md+.gitignore の「未コミット状態」を1回、副作用として誤検知し、Opus が毎回 git mtime/履歴を手確認して棄却した。adversarial verify の信頼性と判定コストを損なう。
> **事実訂正（critic 指摘）**: 当初 why の「祖先コミット `01fcf10` を HIGH/medium 判定」は実ログ（`wf_1101cd5b`: severity=low, highSeverity=[]）と不一致。`01fcf10` 誤検知は **LOW**（Opus の手確認コスト増のみ）。主 fix 対象は settings.json×2・exec.md+.gitignore×1 の **HIGH/medium** false positive、`01fcf10` LOW は secondary。

**要件**:
1. verifier が baseline（task 開始前の状態 / 当該 task の diff スコープ）を根拠に、task 由来でない差分を副作用判定しない。
2. 既存 verdict schema（lens/matches/deviations/summary、集約 consensusMatch/matchVotes/highSeverity）は後方互換。
3. read-only 維持。
4. 呼び出し側 exec.md の args 契約（taskId/targets/planExcerpt/diffText/codexSummary/cwd）を壊さない。baseCommit 等を追加する場合は **undefined 時に従来動作へフォールバック**。

**前提**:
- false positive の根本は**2層**: (L1) verifier prompt に「自前 git diff/status/log 禁止・渡された diffText のみを根拠とせよ」の明示制約が無い → sonnet verifier が現在のファイル状態を自由に取得できる。(L2) baseline（task 開始前 HEAD SHA）が args に無い → verifier が見た差分が task 由来か pre-existing かを構造的に区別できない。
- `diffText` フォールバック（L18）は「Read して判定せよ」と促す設計で、baseline 無しでは副作用レンズが必然的に誤検知する。
- exec.md(c) の `git diff -- <対象ファイル>` スコープ絞りは Opus への努力義務にすぎず workflow 内部に未伝播。
- exec.md allowed-tools は現状 `git diff`/`git status` のみ（`git rev-parse` は task-4 で worktree 系と共に追加済みかは要確認）。

## 調査結果（goal実態 / 現状実態 / ギャップ）

- **goal実態**: workflow は args→3レンズ並列(sonnet)→多数決。verifier prompt は「対象ファイルを Read し diff と突き合わせ」のみで baseline 受け渡し無し。VERDICT_SCHEMA は additionalProperties:false（返却側を変えずに args 追加で対応可能）。
- **現状実態**: settings.json は HEAD `3642a93`(5/31) から未コミット差分が常在 → verifier が Read すれば「task が想定外変更した」と誤判定する条件が常に成立。exec.md(c) は diffText を対象ファイルに絞って渡しているが、verifier が diffText を超えて自前 git を叩けば無意味。
- **ギャップ**: (a) verifier の自前 git 実行を禁止する prompt 制約、(b) baseCommit を渡し副作用評価を `baseCommit..HEAD` に限定、(c) diffText フォールバックを baseline 優先に、(d) exec.md allowed-tools に `git rev-parse` 追加＋(c)段 args に baseCommit。

## 実行計画（候補 A＝最小・PR#12 非衝突 を主案。⚖️ は下記）

- [ ] task-1: side-effects verifier に「自前 git 実行禁止・diffText のみ根拠」制約を追加
  - 操作対象: `workflows/goal-exec-verify.workflow.js`（agent prompt L73-79 / side-effects focus L31-35）
  - 操作内容: verifier prompt に「`git diff`/`git status`/`git log` 等を自前実行してはならない。渡された `diffText` のみを差分の根拠とせよ。`diffText` に無い変更を副作用と判定するな」を追記。side-effects focus に「pre-existing/未コミット差分は副作用ではない」を明記。
  - 影響場所と効果: verifier が現在ファイル状態の pre-existing 差分を拾う L1 経路を塞ぐ。
  - goalへの影響: 主要件(1) を prompt レベルで満たす（最小）。
- [ ] task-2: diffText フォールバック文言を baseline 優先に修正
  - 操作対象: `workflows/goal-exec-verify.workflow.js:18`
  - 操作内容: 「diff 未提供時は対象ファイルを Read」だけの現行を、「diffText が空でも対象ファイルと plan 設計の整合のみ見る。pre-existing 差分は副作用と見なすな」へ。
  - 影響場所と効果: フォールバック分岐の誤検知も抑止。
  - goalへの影響: 要件(1) の穴を塞ぐ。

## 未確定・要判断事項（tournament 結果）

dme② が3候補を生成、ペア比較トーナメントを回したところ **基準級で割れた**（champion を強制せず ⚖️ で返す）:

- ⚖️ **③基準: 最小/非衝突 か 堅牢/独立検証 か**
  - **候補A（採用＝主案）**: prompt lockdown のみ（task-1,2）。workflow.js だけ・exec.md 無変更 → **PR#12 と非衝突**・最小。弱点: verifier が prompt に従う前提（sonnet が git を叩けば破れる）。L1 のみ対処。
  - **候補B**: baseCommit baseline。args に baseCommit 追加、side-effects は `baseCommit..HEAD` を評価。exec.md(c) が `git rev-parse HEAD`(codex 実行前)を渡す＋allowed-tools に `git rev-parse` 追加。**堅牢**（verifier が独立に真の task 差分を計算可）だが exec.md を触る → **未マージの PR#12 と衝突リスク**。L2 を対処。
  - **候補C**: A+B 併用（最堅牢・最大サーフェス）。
  - 実行級（正しさ/きれいさ）では決まらず、**「最小・非衝突を core にするか、堅牢・独立検証を core にするか」は価値判断 → 人間に返す**。
- ⚖️ **exec.md 変更と PR#12 の順序**: 候補B/C は exec.md を触るため、未マージの PR#12（exec.md 大改変）とのマージ衝突を招く。B/C を採るなら **PR#12 マージ後に着手**するか、PR#12 に同梱するかを決める必要。
- ⚖️ **前提検証（critic 指摘 task-0 相当）**: そもそも verify の sonnet verifier が Bash/git を実行できるかを最小 workflow で実証してから fix 範囲を確定すべき（A の prompt lockdown が効くか否かの前提）。`feedback_goal_exec_loop.md` の既存却下記録との整合も要確認。

## PR仕様（PR / スコープごと）

- PR-1: `~/.claude`（候補A: side-effects 誤検知の最小修正）
  - 目的: verifier が pre-existing/未コミット差分を副作用と誤検知しないよう、prompt を diffText 限定にする。
  - 満たすべき要件: verdict schema 後方互換 / read-only 維持 / exec.md・args 契約は無変更（PR#12 非衝突）。
  - 着手前 / 完了後: verifier が自前 git で pre-existing を拾い false positive → diffText のみ根拠で誤検知抑止。
  - 作業フロー図（mermaid）:
    ```mermaid
    flowchart TD
      A[task-1: verifier prompt に 自前git禁止/diffText限定] --> C[node --check]
      B[task-2: diffText フォールバックを baseline優先] --> C
      C --> D[最小 verify dry-run で誤検知再現せぬこと確認]
    ```
  - Verification: `node --check workflows/goal-exec-verify.workflow.js`（＋ pre-existing 差分がある状態での最小 verify dry-run で side-effects が誤検知しないこと）。初回は exec 権限外のため Claude 照合＋人間の `!` 実行。
  - 解決タスクと goal への効果: task-1/2 → L1（prompt）の false positive を最小コストで解消。
  - PR外への影響: exec.md・args 不変のため PR#11/#12 と非衝突。
  - その他共有事項: 堅牢版（候補B/C＝baseCommit baseline）は ⚖️ 未確定。robustness を core にするなら別 PR で PR#12 マージ後に着手。
