# taskflow-live-visualizer 公開API (SCHEMA.md)

goalflow のタスク設計DAG＋実行状態ライブ可視化の公開APIを定義する。plan emit(`/goal:plan`) / exec-v4 / fusion層(`skills/goalflow-viz`) / renderer(`renderer.html`) すべてがこの契約にぶら下がる。実行中は plan-exec 契約により DAG 凍結(固定レイアウト＋状態オーバーレイ)とする。

## 1. tasks.json (plan emit・静的DAG)

- 生成元: `/goal:plan` の追加出力。置き場所: `docs/plans/<slug>.tasks.json` (git 追跡される)。
- JSON スキーマ:

```json
{
  "planSlug": "string (plan の slug。docs/plans/<slug>.md の slug)",
  "generatedAt": "string (ISO8601。plan 生成時刻)",
  "tasks": [
    {
      "id": "string (安定タスクID。plan.md 散文の task-N と一致)",
      "label": "string (短いタスク名)",
      "tier": "A|B|C (exec-v4 の検証 Tier)",
      "targets": ["string (操作対象ファイルの相対パス)"],
      "deps": ["string (依存する他タスクの id)"],
      "lane": "null|number (並列バッチ番号。v1 は null=直列)"
    }
  ],
  "edges": [ { "from": "string (id)", "to": "string (id)" } ]
}
```

- `edges` は `deps` から導出する冗長表現(renderer 利便のため)。task B が `deps:[A]` を持つなら edge は `{from:A, to:B}` (from=先に完了すべき依存元、to=依存する側)。
- `lane`: v1 は全 `null` (直列フロー)。並列実証後に int(バッチ番号)を入れると renderer が横レーン表示に切替。

## 2. graph-data (renderer 入力 = tasks.json + status overlay)

- 生成元: fusion 層(`skills/goalflow-viz`)。`tasks.json` と同形だが各 task に `status` を付与し、`runWindow` を持つ。
- JSON スキーマ:

```json
{
  "planSlug": "string",
  "generatedAt": "string",
  "runWindow": "string|null (ISO8601。status を集計した run の起点。通常 tasks.json の mtime)",
  "tasks": [
    {
      "id": "string", "label": "string", "tier": "A|B|C",
      "targets": ["string"], "deps": ["string"], "lane": "null|number",
      "status": "pending|running|committed|verified|failed"
    }
  ],
  "edges": [ { "from": "string", "to": "string" } ]
}
```

### status enum

| status | 意味 |
| --- | --- |
| `pending` | 未着手(codex 未実行) |
| `running` | codex 実行中/実行済だが未コミット |
| `committed` | per-task commit 済(未 verify) |
| `verified` | verify で `consensusMatch=true` |
| `failed` | verify で `consensusMatch=false` または high severity 乖離あり |

### renderer 表示状態

renderer は `status` と `deps` から次の5表示状態を導出する。

| 表示状態 | 導出条件 |
| --- | --- |
| `done` | `verified` |
| `current` | `running` |
| `next` | `pending` かつ `deps` が全て `verified` |
| `blocked` | `pending` かつ `deps` に未 `verified` が残る |
| `failed` | `failed` |

`committed` は verify 待ちの中間表示とする。

### 色マッピング(renderer 契約)

| status / 表示状態 | 色 |
| --- | --- |
| `pending` | 灰 |
| `running` | 青 |
| `committed` | 黄 |
| `verified` | 緑 |
| `failed` | 赤 |
| `blocked` | 暗灰 |

## 3. id 規約(安定ID貫通)

- `id` は `plan.md` 散文の `- [ ] task-N` の `task-N` と完全一致する安定文字列。
- exec-v4 はこの `id` を canonical task-id として codex 呼び出し `-o .codex-out/<id>.md`・branch `goalflow/<run-id>/<id>`・verify の `args.taskId` に貫通させる。
- 同一 plan の同一タスクは run をまたいでも同じ `id` (再順序耐性)。

## 4. event source (fusion が status を計算する3観測 seam・コア無編集)

fusion はコアを編集せず、次の3観測 seam から `status` を計算する。

1. running/done: `.codex-out/<id>.md` の存在 = codex がそのタスクを実行した。
2. committed: `git log` で当該タスクの per-task commit を検出(commit message か対象ファイル変更)。
3. verified/failed: verify journal `wf_*.json` (`projects/<session>/workflows/` 配下)を glob し、`workflowName` が `goal-exec-verify` かつ `args.taskId` または `result.taskId` が `id` と一致するものの `result.consensusMatch` で判定する。

重要: journal の top-level `taskId` は workflow 内部 run-id なので使わない。必ず `args.taskId` か `result.taskId` を使う。`result.highSeverity` が非空なら `failed` 寄せにする。

## 5. run-window scoping (last-run-wins)

- `.codex-out/` は run-id 名前空間を持たず複数 run が同名ファイルを上書きする(v1 仕様)。
- fusion は `run-window = docs/plans/<slug>.tasks.json` の mtime とし、それ以降に変更された event のみを現 run として採用する(`mtime >= runWindow`)。
- これにより旧 run の `.codex-out/<id>.md` 残骸を現 run の完了として誤検知しない。
- 完全な run 分離(run-id サブディレクトリ化)は v-next(exec-v4 の `-o` 変更)であり v1 ではやらない。

## 6. 後方互換

- `tasks.json` は任意。`plan.md` の `.md` 出力は不変。
- exec-v4 は `tasks.json` 不在時、従来通り `plan.md` 散文から task-id を導出する(fallback)。

## 7. lane と並列 (v1=直列固定)

- v1 は exec-v4 の worktree 並列が未実証ゆえ全 `lane=null` (直列フロー)。
- 並列実証後、`tasks[].lane` に int(バッチ番号)を入れると renderer が横レーン表示に切替。branch-merge バリアの可視化は将来 ramp。
