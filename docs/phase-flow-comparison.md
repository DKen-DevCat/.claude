# Phase-flow 構成: nestify vs cf-local

`/phase-*` + `/review-diff` + `/check` を中心とした開発フローを 2 PJ で揃えた記録 (2026-04-30)。

3 つ目以降の PJ で同じ構成を立ち上げるためのテンプレ + 今回見えた課題のメモ。

---

## 1. 構成要素の対応表

| 役割 | nestify (Bun + TS) | cf-local (Go) |
|---|---|---|
| **CLAUDE.md `Skills config`** | あり (Bun コマンド前提) | あり (`commit_msg_hook_requires_tasks: false`) |
| **必読順序** | CLAUDE.md / 各種 docs | README → DESIGN.md → plan.md → tasks.md → design/<active> → conventions.md |
| **ベースブランチ** | `develop` | `develop` |
| **commit-msg hook** | あり (`tasks.md` 必須) | **なし** |
| **`/phase-kickoff`** | global skill (`~/.claude/skills/`) | global skill |
| **`/phase-resume`** | global skill | global skill |
| **`/phase-spec`** | global skill | global skill |
| **`/phase-ship`** | global skill | global skill |
| **`/phase-review`** | project 上書き有 (旧インライン版) | **global のみ** (新 /check 委譲版) |
| **`/review-diff`** | project skill (subagent: code-reviewer × 3) | project skill (subagent: general-purpose × 3) |
| **`/check`** | project skill: tsc / BE test / FE test / FE lint | project skill: `go vet` / `gofmt -l .` / `go test ./internal/...` |
| **`.claude/rules/`** | 5 ファイル (backend, frontend, code-style, quality, testing) | 2 ファイル (code-style, quality) |
| **`.claude/agents/`** | 3 つ (code-architect, code-explorer, code-reviewer) | **なし** |
| **`.claude/plan.md`** | フェーズレジストリ | フェーズレジストリ |
| **`.claude/tasks.md`** | 進行中タスク | 進行中タスク |
| **`.claude/design/<slug>-<date>.md`** | フェーズ詳細設計 | フェーズ詳細設計 |
| **`.claude/tasks-archive/`** | あり | (空 or 未生成) |

---

## 2. 差分とその理由

### 2.1 `/check` の中身 (Bun ↔ Go)

| | nestify | cf-local |
|---|---|---|
| 並列タスク数 | 4 | 3 |
| 型チェック | `bunx tsc --noEmit` (`-p packages/...` で分割) | `go vet ./...` (型 + 静的解析を兼ねる) |
| フォーマット | (lint に含まれる) | `gofmt -l .` (出力あれば FAIL) |
| ユニットテスト | BE / FE 2 系統 | `go test ./internal/...` (1 系統) |
| Lint | FE のみ (`bun lint`) | (vet + gofmt で代替) |
| 統合テスト | E2E は除外 | integration / α regression は除外 |

**理由**: 言語ツールチェーンの違い。Go は `go vet` が型 + 簡易静的解析を兼ね、`gofmt -l .` が空出力 = 整形済みという素朴な判定で済む。Bun/TS は tsc / lint / test が分かれているのでタスクが増える。

### 2.2 `/review-diff` の subagent

| | nestify | cf-local |
|---|---|---|
| subagent_type | `code-reviewer` (project agent) | `general-purpose` |
| ルールファイル | 5 種類を用途ごとに振り分け | 2 種類 + CLAUDE.md / DESIGN.md / docs/conventions.md を直接 Read |
| Agent A | code-style + quality | code-style + conventions |
| Agent B | (frontend or backend) + testing | quality + DESIGN.md (スコープ + テストファースト) |
| Agent C | バグ + 型 + セキュリティ | バグ + 型。**セキュリティ機能の欠如は指摘しない** (DESIGN.md 前提) |

**理由**:
- nestify はカスタム `code-reviewer` agent を作り込んでいるが、cf-local では未整備のため `general-purpose` で代替。指摘の質を上げるなら次は cf-local 側にも `.claude/agents/code-reviewer.md` を起こすのが第一歩。
- ルール数の差は「コードベースの広さ」の差。cf-local は Go 単体 + njs 少々なので 5 ファイル分は無くて良い。
- セキュリティ観点を抑える指示は cf-local 固有。**ローカル開発ツール**という DESIGN.md 前提があるため、認証 / 暗号化の不在を指摘されても無価値。

### 2.3 `/phase-review` の所在

| | nestify | cf-local |
|---|---|---|
| project skill | あり (旧インライン /check 版) | **無し** (global を使う) |
| Step 7 検証 | tsc/test/lint をインライン記述 | `/check` skill 委譲 |

**理由**: global の phase-review は最近 `/check` 委譲型にリファクタされた。nestify 版は project skill が globalより古い実装で残っている。cf-local では project skill を作らず global を使う方が綺麗。
→ **改善余地**: nestify の project 版 phase-review を global 委譲型に揃えると、project からは消せる (DRY)。

### 2.4 `commit_msg_hook_requires_tasks`

| | nestify | cf-local |
|---|---|---|
| 値 | `true` (既定) | `false` (CLAUDE.md で明示) |

**理由**: nestify は `.git/hooks/commit-msg` で `tasks.md` への進捗追記を強制。cf-local はそのフックを未導入のため、`/phase-review --fix` の Step 8 で tasks 追記をスキップしてよい。導入の有無は PJ ポリシー次第なので config で吸収する形になっている。

---

## 3. 複製テンプレ (3 つ目の PJ を立ち上げる手順)

新 PJ で同じフローを動かすためのチェックリスト。

### 3.1 必須 (これだけで `/phase-*` + `/phase-review` が動く)

- [ ] `CLAUDE.md` を作成し、必読順序 + 作業哲学 + `## Skills config` ブロックを入れる
  - `phase.base_branch` (PJ の develop 相当)
  - `phase.commit_msg_hook_requires_tasks` (hook を入れるかどうか)
  - 他は既定で十分
- [ ] `.claude/plan.md` を作成 (空のフェーズレジストリ)
- [ ] `.claude/tasks.md` を作成 (空 or 進行中フェーズの雛形)
- [ ] `.claude/design/` ディレクトリを作成
- [ ] `.claude/skills/check/SKILL.md` を作成 — **PJ 固有のコマンドを並列化**
- [ ] `.claude/skills/review-diff/SKILL.md` を作成 — Step 2 の Read 対象と Step 3 の subagent 担当ルールを PJ に合わせて差し替え
- [ ] `.claude/rules/code-style.md` と `.claude/rules/quality.md` を最小セットで起こす

### 3.2 任意 (規模が大きくなったら)

- [ ] `.claude/agents/code-reviewer.md` を作成 → `/review-diff` の subagent_type を切り替え
- [ ] `.claude/rules/` を領域別に分割 (例: `backend.md` / `frontend.md` / `testing.md`)
- [ ] commit-msg フックを導入し、`commit_msg_hook_requires_tasks: true` に切り替え
- [ ] `.claude/tasks-archive/` を導入してフェーズ完了タスクを保管

### 3.3 不要 (project 上書きしない)

- `~/.claude/skills/` 配下の `phase-kickoff` / `phase-resume` / `phase-spec` / `phase-ship` / `phase-review` は global のまま使う。
  PJ 固有事項は `Skills config` ブロックで吸収できる設計になっている。

---

## 4. 今回見えた課題 / 改善ポイント

### 4.1 nestify の `/phase-review` が古い

global は `/check` 委譲型に進化したが nestify project 版は旧インライン版のまま。
→ nestify の `.claude/skills/phase-review/SKILL.md` を消すか、global と同じく `/check` 委譲版に書き換える。**機能差は出ないので消す方が DRY**。

### 4.2 cf-local の subagent 品質

`general-purpose` 代替なので、`code-reviewer` 専用 agent を作ったときに比べてレビュー粒度が粗くなりがち。
→ cf-local の規模が拡大して気になり始めたら `.claude/agents/code-reviewer.md` を起こす。優先度は中。

### 4.3 `Skills config` の発見性

CLAUDE.md の中盤に置いてあるだけで、新 PJ 立ち上げ時に「これがある前提」と気付けない。
→ `~/.claude/skills/phase-kickoff/SKILL.md` のキックオフ手順に「CLAUDE.md に Skills config がなければ追加する」を追記する余地あり。
→ もしくは本ドキュメント (このファイル) を `phase-kickoff` 冒頭から参照させる。

### 4.4 `.claude/rules/` の運用負荷

ルール変更 → review-diff の Read 対象更新が必要。コードベースが小さいうちは「rules 不要、CLAUDE.md / conventions.md を直接 Read」で済ませる選択肢も成立する。
→ cf-local は今 2 ファイルだが、もし 1 ファイルにまとまってしまうなら conventions.md だけ Read して rules を消す決断もありうる。

### 4.5 `/check` の性能

cf-local は 3 並列で軽量 (~5s)。nestify は 4 並列で 30s 前後。
→ 大きな差ではないが、tsc が遅い PJ では `--noEmit` を分割して `incremental` を効かせる工夫が要る。

### 4.6 セッション途中で追加した agent は **使えない** (2026-05-01 発見)

cf-local PR #6 のドッグフード時に判明:

- Claude Code の harness は **セッション開始時** に `.claude/agents/` をスキャンして `subagent_type` の候補を確定する
- セッション途中で `.claude/agents/code-reviewer.md` を新規追加 → 同セッション内で `Agent(subagent_type: "code-reviewer")` を呼ぶと `Agent type 'code-reviewer' not found. Available agents: claude-code-guide, Explore, general-purpose, Plan, statusline-setup` で失敗する
- セッション再起動で agent 一覧が更新され、以降は使える

**実用上の意味**:
- 新規 PJ で `.claude/agents/` を整備した直後は、必ず一度 Claude Code を再起動してから `/phase-review` 等を叩く
- `/phase-kickoff` で agent を追加するフェーズの場合、kickoff の最後に「セッション再起動してください」と案内する余地あり
- skill (`.claude/skills/`) も同じ挙動かは未確認。少なくとも skill は session 開始時の available skills リストに乗るので同様の可能性が高い

→ `phase-kickoff` skill のドキュメントに「`.claude/agents/` を新規追加した直後はセッション再起動が必要」を一行追記する余地あり (将来 TODO)。

### 4.7 cf-local PR #8 ドッグフード結果 (chore-1-4 / phase-4a 4a-18)

cf-local Phase 4-A で `/phase-review --pr 8` を 2 回試走 (REV-1〜REV-7 / REV-1〜REV-4 の計 11 件、すべて採用)。`code-reviewer` agent 切替 (chore-1 PR #6) 後の初回ドッグフード。

#### 観測軸 (a) `general-purpose` 比での粒度・正確性

**改善あり**。`general-purpose` 時代に出がちだった「一般論的な改善提案」が消え、`.claude/rules/` 明文への紐付け指摘が増えた:

- REV-1 (XmlnsCloudFront → XMLNSCloudFront) / REV-2 (WebACLId → WebACLID): `code-style.md` §命名「略語は大文字統一 (`URL`, `HTTP`, `XML`)」を直接根拠にした指摘
- REV-2 (`fmt.Errorf("...")` → `errors.New("...")`): `code-style.md` §エラーハンドリング「wrap しない場合は `errors.New`」のパターン整合
- REV-3 tagging handler テスト追加: `quality.md` §テスト「新規ロジックには `*_test.go`」「HTTP ハンドラは `httptest`」を明文引用
- REV-4 `Reloader.nowFn` dead field 削除: `quality.md` §抽象化「重複が 3 回未満で抽象化されていたら過剰抽象の疑い」+ CLAUDE.md「過剰抽象化禁止」を根拠

false positive は 11 件中 0。採用率 100% (採用ベース取下げ無し)。

#### 観測軸 (b) 4 軸並列の効き — 特に軸 (4) 公式ドキュ準拠

**軸 (4) は今回素通り**。11 件中、context7 で公式ドキュを引いた指摘は 0 件。AWS XML 仕様 / `encoding/xml` 慣用 / bbolt のベストプラクティスに踏み込んだ指摘は出ていない。

ただし「素通り = 軸 (4) Agent が機能していない」と「素通り = 該当する逸脱がコード側に無い」が分離できていない。Phase 4-A は `awsxml.WriteXMLError` の自前実装や bbolt の `Update` 利用が新規導入されているので、軸 (4) が機能していれば 1 件は引っかかってもおかしくない領域。

→ **次回観測**: phase-4b (Invalidation API 互換) で `/phase-review` 試走時に、軸 (4) Agent の出力を `general-purpose` の単体出力と比較する形で検証する余地。SKILL.md 側で 4 軸の出力を「どの軸由来か」明示してマージするよう変えると分離評価しやすい。

#### 観測軸 (c) 設計思想整合 (軸 3) で design ドキュ参照が効いているか

**部分的に効いている**。REV-4 (dead field 削除) で CLAUDE.md「動かないコードを増やすより動く範囲を少しずつ広げる」を引用した点は軸 (3) の効きと読める。一方、`.claude/design/phase-4a-terraform-2026-05-01.md` を直接根拠にした指摘は 0。

スコープ越境チェック (Managed ORP seed が phase-4a スコープ外、Managed CachePolicy seed は phase-4a スコープ内) は **越境がそもそも発生していない** ため検証ケースなし。Phase 4a で「やらない」リストに抵触しそうな差分が無かったので、軸 (3) の真価は次フェーズ以降の試走待ち。

#### 総合判断

- code-reviewer agent への切替は **規約準拠系の指摘で確実に効いている** (粒度・採用率ともに改善)
- 軸 (4) 公式ドキュ準拠は **空振り**。観測ケースが少なすぎて評価保留 (phase-4b で再検証)
- 軸 (3) 設計思想整合は **CLAUDE.md は効いている / design ドキュ参照は未確認**

→ chore-1-3 (rules 領域別分割) は **据え置き判断が妥当**。今回 11 件すべて `code-style.md` / `quality.md` の 2 ファイルで根拠が取れており、Go / njs / Markdown が混じった精度低下は観測されなかった。phase-4a は Go 単体差分なので njs 混在のテストにはなっていない。phase-4d (Lambda@Edge / njs + Go 混在) で再評価。

#### 副次観測: ドッグフード 2 回が両方 `code-reviewer` 切替後

PR #6 マージで agent が利用可能になったあと、PR #8 内で 2 回 `--fix` が走った。1 回目 (REV-1〜7) は CachePolicy 周辺、2 回目 (REV-1〜4) は Distribution + nginx reload + tagging stub 周辺。**両方とも軸 (1)(2)(3) で同質の指摘パターンが出ており、agent の出力は安定している** (run-to-run の揺らぎが小さい)。

### 4.8 PJ 間の sync 戦略 (未決)

global skill は更新したら全 PJ に効くが、project skill (review-diff / check / rules) は手動コピーになる。
→ 候補:
  - (a) global に全部寄せて project は config だけにする (`/check` を generic にできるか不明)
  - (b) `~/.claude/templates/` を作りそこからコピーする手順を `/phase-kickoff` に組み込む
  - (c) 各 PJ で個別維持 (現状)。運用コストは小さいが、ベストプラクティスの逆輸入が遅れる
  - 当面は (c)。3 つ目の PJ で複製コストが気になり始めたら (b) を検討。

---

## 5. フロー図

### 5.1 フェーズライフサイクル (全体)

```mermaid
flowchart LR
  idea([アイデア / 着手判断]) --> spec["/phase-spec"]
  spec -->|plan.md にエントリ追加| ready([レジストリ登録済])
  ready --> kickoff["/phase-kickoff"]
  kickoff -->|ブランチ作成<br/>design 起こす<br/>tasks 進行中セクション| impl([実装 + コミット])

  impl --> review["/phase-review"]
  review -->|指摘なし or 採用済| ship["/phase-ship"]
  review -->|--fix で修正コミット| review

  ship -->|/check → PR 作成 / 反映<br/>→ /phase-review --fix → push| pr([PR レビュー / マージ])
  pr --> done([フェーズ完了])
  done -->|plan.md status 更新<br/>design に Phase 完了メモ| next([次フェーズ])

  resume["/phase-resume"] -.->|セッション再開時| impl
  resume -.-> review
  resume -.-> ship

  classDef skill fill:#e0f2fe,stroke:#0284c7,color:#0c4a6e;
  class spec,kickoff,review,ship,resume skill;
```

### 5.2 `/phase-review` の内部展開

```mermaid
flowchart TD
  start(["/phase-review [--pr N] [--fix]"]) --> cfg[CLAUDE.md Skills config 読取]
  cfg --> step1[Step 1: 対象 diff 確定<br/>--pr 指定 → gh pr diff<br/>無指定 → git diff HEAD]
  step1 --> par{Step 2: 並列起動}

  par -->|--skip-style でない| rd["/review-diff"]
  par -->|--skip-security でない| sec["/security-review"]

  rd --> a1["Agent A<br/>style + conventions"]
  rd --> a2["Agent B<br/>quality + design"]
  rd --> a3["Agent C<br/>bug / type"]
  a1 --> merge[Step 3: 重複統合<br/>confidence ≥ 80<br/>採否提案]
  a2 --> merge
  a3 --> merge
  sec --> merge

  merge --> step4[Step 4: 採否提案を出力<br/>TaskCreate REV-1..N]
  step4 --> isfix{--fix?}
  isfix -->|no| done1([終了 / 手動対応])

  isfix -->|yes| step5[Step 5: ユーザー承認<br/>all / none / 番号 / propose]
  step5 --> step6[Step 6: Edit で修正適用]
  step6 --> step7["Step 7: /check"]
  step7 -->|FAIL| abort([中断 / コミットなし])
  step7 -->|PASS| step8{Step 8: tasks 追記}
  step8 -->|hook あり| append[tasks.md に REV-* 完了印]
  step8 -->|hook なし| skiptasks[skip]
  append --> commit[ユーザー承認後 git commit]
  skiptasks --> commit
  commit --> done2([Step 9: result サマリ])

  classDef skill fill:#e0f2fe,stroke:#0284c7,color:#0c4a6e;
  classDef agent fill:#fef3c7,stroke:#d97706,color:#78350f;
  class rd,sec,step7 skill;
  class a1,a2,a3 agent;
```

### 5.3 skill 解決順 (global vs project)

```mermaid
flowchart TD
  in["ユーザーが /X を入力"] --> q1{".claude/skills/X/SKILL.md<br/>project に存在?"}
  q1 -->|yes| proj["project skill 実行<br/>※ global を上書き"]
  q1 -->|no| q2{"~/.claude/skills/X/SKILL.md<br/>global に存在?"}
  q2 -->|yes| glob["global skill 実行"]
  q2 -->|no| q3{"built-in 組込<br/>/help, /clear,<br/>/security-review 等"}
  q3 -->|該当| builtin["built-in 実行"]
  q3 -->|該当なし| err(["Unknown command"])

  classDef proj fill:#dcfce7,stroke:#16a34a,color:#14532d;
  classDef glob fill:#e0f2fe,stroke:#0284c7,color:#0c4a6e;
  classDef bi fill:#f3e8ff,stroke:#9333ea,color:#581c87;
  class proj proj;
  class glob glob;
  class builtin bi;
```

備考:
- `/security-review`, `/review`, `/init` は built-in (Anthropic 公式提供)
- `/phase-*`, `/check`, `/review-diff` などは skill (project または global)
- `Skills config` (CLAUDE.md) は **どの階層の skill からも参照される**

### 5.4 データフロー (skill とファイル)

```mermaid
flowchart LR
  subgraph CFG[CLAUDE.md]
    skills_cfg[Skills config<br/>YAML ブロック]
  end

  subgraph PHASE[.claude/]
    plan[plan.md<br/>フェーズレジストリ]
    tasks[tasks.md<br/>進行中タスク]
    design[design/&lt;slug&gt;-&lt;date&gt;.md]
    rules[rules/*.md]
    archive[tasks-archive/]
  end

  subgraph CODE[ソースコード]
    src[cmd/, internal/, ...]
    pr_meta[(GitHub PR)]
  end

  spec["/phase-spec"]
  kickoff["/phase-kickoff"]
  resume["/phase-resume"]
  review["/phase-review"]
  ship["/phase-ship"]
  rd["/review-diff"]
  check["/check"]

  skills_cfg -.read.-> spec & kickoff & resume & review & ship & rd & check

  spec -->|append| plan
  spec -.optional append.-> tasks

  kickoff -->|status 更新| plan
  kickoff -->|create| design
  kickoff -->|進行中セクション| tasks

  resume -->|read| plan
  resume -->|read| tasks
  resume -.read.-> archive

  review --> rd
  review --> check
  review -.append REV-*.-> tasks
  rd -->|read| rules
  rd -->|read| design
  rd -->|read diff| src
  rd -.optional read.-> pr_meta
  check -->|vet/test| src

  ship -->|read| design
  ship -->|status 更新| plan
  ship -->|push| pr_meta

  classDef skill fill:#e0f2fe,stroke:#0284c7,color:#0c4a6e;
  class spec,kickoff,resume,review,ship,rd,check skill;
```

凡例:
- 実線 (`-->`) : 書き込み or 主要な読み取り
- 点線 (`-.->`) : 条件付き読み取り or オプション処理
- 青背景 : skill (project / global いずれか)

---

## 6. 履歴

- 2026-04-30: nestify を一次レファレンスとして cf-local に同構成を移植。本ドキュメント作成。
- 2026-04-30: フロー図 4 種 (lifecycle / phase-review 内部 / skill 解決 / データフロー) を追加。
- 2026-05-01: cf-local PR #6 ドッグフードで「セッション途中追加 agent は使えない」を発見、§4.6 に追記。
- 2026-05-02: cf-local PR #8 で `code-reviewer` agent 切替後の初回ドッグフード結果 (REV-1〜7 + REV-1〜4 の計 11 件、採用率 100%) を §4.7 に追記。chore-1-4 / phase-4a 4a-18 完了。
