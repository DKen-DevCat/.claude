---
name: phase-spec
description: 会話で固まったアイデアを抽出チェックリスト 7 項目で網羅検証し、phase registry に新エントリとして追記する（または既存エントリへ追加）。/phase-kickoff の前段で動く
---

# /phase-spec

会話の中で揺れ動きながら固まるアイデア・要件を、**抽出チェックリスト 7 項目**で網羅検証してから phase registry に**もれなく**書き出す。
書き込み先は **phase registry のみ**（既定）。design ファイル / tasks ファイル / ブランチには触れない — それらは `/phase-kickoff` 以降の責務。

> 棲み分け: 自律実装は `/goal:exec-v5`（正本）が担う。phase-* は人間駆動の手動フェーズ運用トラックであり、phase-spec はそのトラックのフェーズ登録工程を担う。
> 計画アーティファクトの棲み分け: 深い実現可能性調査を伴う計画は `/goal:plan`（`docs/plans/<goal-slug>.md` を生成）、フェーズ registry への軽量登録は phase-spec が担う。二重の計画アーティファクトが競合しないよう、重い調査計画は goal:plan 側に寄せ、phase-spec は registry エントリの網羅登録に徹する。

## 設定読み取り（先頭で一度だけ）

CLAUDE.md は自動ロードされている。文脈中の `## Skills config` 見出し直下の最初の ```yaml フェンス内 YAML を参照して以下を確定する。
キーが無ければ既定値を使う:

| キー | 既定値 |
|---|---|
| `phase.phase_registry` | `.claude/plan.md` |
| `phase.tasks_file` | `.claude/tasks.md` |
| `phase.branch_pattern` | `feat/{phase-id}-{slug}` |

config ブロック自体が無い PJ では、上記既定値で動作する旨をユーザーに 1 行で通知してから続行する。

## 想定ワークフロー

```
会話でアイデアを詰める
        ↓
/phase-spec               ← phase registry に新エントリ追記
        ↓
/phase-kickoff <phase-id> ← registry から読んでブランチ + design 雛形 + tasks
        ↓ 実装
/check / /dev-restart
        ↓
/phase-ship → PR → review → merge
```

## 引数

- `<要約>` （省略可）: ユーザーが既に整理した要約。省略時は直前会話を Claude が自動要約
- `--new` （既定）: phase registry の **Phase レジストリ**に新エントリを append
- `--append --phase <id>`: 既存フェーズエントリを増補。registry の該当 Phase の「タスク」「影響範囲」に追記し、kickoff 済みなら tasks ファイルの該当セクションにも `- [ ]` を append
- `--phase-id <id>`: `--new` 時のフェーズ ID 指定（省略時は会話から推定して提示、ユーザー確認）

## 実行ステップ

### Step 1. 入力収集 + 前提検証

1. `<要約>` が渡されていればそれを起点にする
2. なければ **直前の会話履歴を自動要約**（「ユーザーが意思決定したこと」と「未決のまま残ったこと」を分離して抽出）
3. **単一メッセージ内で並列 Bash 実行**:
   - `git status --short`
   - `git branch --show-current`
4. `{{phase.phase_registry}}` を Read（テンプレート確認 + 既存エントリ確認）
5. `--append` 時のみ `{{phase.tasks_file}}` も Read（既存セクション確認）

**前提検証（早期中断のため Step 2 に進む前に実施）**:

- `--new` 時: `--phase-id` が会話から推定できないなら、ここでユーザーに ID 確認を取る
- `--append --phase <id>` 時:
  - registry に `## Phase <id>` エントリが存在するか確認 → なければ即時中断、`/phase-spec --new` を提案
  - 進行中（kickoff 済み）の可能性が高ければ tasks ファイルに該当 Phase セクションが存在するか確認 → なければ「kickoff 未実行」を伝えて中断、`--append` ではなく `--new` を提案

これにより、対話補完を 1〜3 ターン消費した後に「実は対象が無かった」となるのを防ぐ。

### Step 2. 抽出チェックリスト走査

会話内容を **7 項目**に分配する。**スキップ禁止**:

| # | 項目 | 必須内容 |
|---|---|---|
| 1 | 目的 / 背景 | なぜやるか、何を解決するか |
| 2 | スコープ | **in / out 両方**を明記（暗黙の除外を禁止） |
| 3 | 影響範囲 | FE / BE / DB / Infra など対象レイヤーを全部チェック（PJ により項目は調整可） |
| 4 | タスク（実装ステップ） | 1 タスク 1 コミット粒度で順序立てる、`<phase-id>-N` 形式で連番 |
| 5 | テスト方針 | 各レイヤーに何を追加するか |
| 6 | 完了条件 | 何が揃ったら閉じるか（テスト数 / 型チェック / lint / ビルド） |
| 7 | リスク / 未決事項 | 後回しにする判断 / 知見不足 / 外部依存 |

各項目について:
- 会話から確定 → 内容を埋める
- 不要 → `N/A` と明記
- 未確定 → `> 未決` マーク付きで保存（暗黙のスキップを禁止）

### Step 3. ドラフト提示と承認

下記フォーマットでユーザーに提示し承認を求める:

```markdown
### Spec draft (mode: <new | append>)

- Target: `{{phase.phase_registry}}`<--append 時は `+ {{phase.tasks_file}} セクション「Phase <id>」` も追記>
- Phase: <phase-id> — <title>
- Branch 案: {{phase.branch_pattern を埋めた値}} または chore/<slug>

#### Checklist coverage

| # | 項目 | 状態 | 概要 |
|---|---|---|---|
| 1 | 目的 | ✓ | <要約> |
| 2 | スコープ | ✓ / 未決 | <要約> |
| ...（7 項目すべて） | | | |

#### Open questions（未決があれば）

- ...

#### Suggested tasks (実装ステップ)

- [ ] <phase-id>-1: ...
- [ ] <phase-id>-2: ...

承認しますか？(y / 修正点を指示)
```

未決項目が残っている場合は、**対話で 1〜3 ターン補完**してから再提示する（いきなり書き込まない）。

### Step 4. ファイル書き込み

承認後にのみ書き込む。

#### `--new` モード

1. `{{phase.phase_registry}}` を Read
2. 末尾の `## Phase レジストリ` セクション直下（または最後のフェーズエントリの後ろ）に **新エントリ**を append:

```markdown
## Phase <phase-id>: <title>

> ステータス: planned
> ブランチ案: {{phase.branch_pattern を埋めた値}} または chore/<slug>
> 作成日: <YYYY-MM-DD>

### 目的 / 背景
<会話で固まった「なぜ」>

### スコープ
- in:
  - ...
- out:
  - ...（明示的に対象外）

### 影響範囲
| レイヤー | 内容 |
|---|---|
| FE | ... |
| BE | ... |
| DB | ... |
| Infra | ... |

### タスク（実装ステップ）
- [ ] **<phase-id>-1**: ...
- [ ] **<phase-id>-2**: ...

### テスト方針
| レイヤー | 何をテストするか |
|---|---|
| BE | ... |
| FE | ... |
| E2E | ... |

### 完了条件
- ...

### リスク・未決事項
- ...
```

3. tasks ファイルには触れない（`/phase-kickoff` の責務）

#### `--append` モード

1. `{{phase.phase_registry}}` を Read し、`## Phase <id>` エントリを見つける
2. 該当エントリの「タスク」セクション末尾に `- [ ]` を append（既存連番の続きを使用）
3. 必要なら「影響範囲」「リスク」セクションにも追記
4. `{{phase.tasks_file}}` を Read し、`## Phase <id>:` または同等タイトルのセクションを見つける
5. 見つかればそのセクション末尾に `- [ ]` を append（kickoff 済み = tasks に該当セクションがある前提）
6. 見つからない場合は中断し、`/phase-kickoff` がまだの可能性をユーザーに報告

### Step 5. コミット案内（自動コミット禁止）

**自動でコミットしない**。下記をユーザーに提示:

```markdown
### Files written

- {{phase.phase_registry}}
<--append 時のみ> - {{phase.tasks_file}}

### Suggested commit

\`\`\`
docs(plan): register Phase <phase-id> — <1 行サマリ>     ← --new 時
docs(plan): expand Phase <phase-id> — <追加内容>          ← --append 時
\`\`\`

このメッセージで `/commit` するか、内容を調整してから手動コミットしてください。

### Next step

\`\`\`
/phase-kickoff <phase-id>   ← registry から読んでブランチ + design + tasks 生成
\`\`\`
```

## 制約

- **書き込みは phase registry のみ（`--append` 時のみ tasks ファイルも）。design ファイル・ブランチ・コミットは責務外**
- **抽出チェックリスト 7 項目のスキップ禁止** — 不要は `N/A`、未確定は `> 未決` マーク必須
- **承認前に書き込まない** — Step 3 のドラフト提示で `y` を取るまでは Read のみ
- 自動要約が長大な履歴で精度低下する場合、Step 2 後の対話補完でカバー
- `--new` 時、フェーズ ID は会話から推定して提示し、ユーザー確認を必ず取る（勝手に決めない）
- `--append` で対象フェーズが registry にない場合は中断、`/phase-spec --new` を提案
