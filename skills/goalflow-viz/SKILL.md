---
name: goalflow-viz
description: goalflow のタスク設計 DAG ＋実行状態のライブ可視化。tasks.json と 3 観測 seam(.codex-out / git commit / verify journal)を融合し、dagre-d3 の固定資産 renderer.html に注入してブラウザ表示する。/goal:viz から呼ばれる。
---

# goalflow-viz

このスキルは `docs/plans/<slug>.tasks.json` を、実行状態オーバーレイ付きの DAG として可視化する。入力と出力の公開 API は `docs/viz/SCHEMA.md` の `tasks.json` / `graph-data` スキーマに従う。

呼ばれたら次を実行する:

```bash
node skills/goalflow-viz/fuse.mjs <slug> --open
```

`fuse.mjs` は決定論的な Node.js スクリプトで、`tasks.json` と 3 つの観測 seam を融合して `graph-data` を作り、`skills/goalflow-viz/renderer.html` の `<script id="graph-data" type="application/json">` に注入した HTML を生成してブラウザで開く。

3 seam は次の通り:

- `.codex-out/<task-id>.md`: run-window 以降の mtime なら `running`
- `git log --since=<runWindow> -- <targets...>`: 対象ファイルに run-window 以降の commit があれば `committed`
- verify journal `projects/-Users-ooizumiyou--claude/**/workflows/wf_*.json`: `workflowName` または `summary` が `goal-exec-verify` を示し、`args.taskId` または `result.taskId` が一致する最新 journal から `verified` / `failed`

run-window は既定で `docs/plans/<slug>.tasks.json` の mtime。`--since <ISO8601>` で明示上書きできる。これにより `.codex-out` の古い残骸を現 run の状態として拾わない。

出力先は既定で `.goalflow/viz/<slug>.html`。このスキルは read-only / 非侵襲で、exec の挙動・コスト・性能には触れない。書き込みは生成 HTML のみで、renderer の固定資産は読むだけ。

task-6 の `skills/goalflow-viz/watch.sh` と `/goal:viz <slug> --watch` が入ると、L1 + watch により同じ fusion を再実行して自動リフレッシュできる。
