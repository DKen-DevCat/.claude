---
description: goalflow のタスク設計 DAG ＋実行状態をライブ可視化する(plan の tasks.json と 3 seam を融合し dagre-d3 でブラウザ表示)。
argument-hint: docs/plans/<goal-slug>.md [--watch]
allowed-tools: Read, Glob, Bash(node:*), Bash(find:*), Bash(git log:*), Bash(open:*), Bash(mkdir:*), Bash(fswatch:*), Skill
---

# /goal:viz

`/goal:viz <slug-or-planpath> [--watch]`

`$ARGUMENTS` から `--watch` の有無を読み取り、残りの引数を slug または plan path として扱う。`docs/plans/<slug>.md` や `docs/plans/<slug>.tasks.json` が渡された場合は、`docs/plans/` と `.md` / `.tasks.json` を剥がして slug を導出する。

`docs/plans/<slug>.tasks.json` が無い場合は、先に `/goal:plan <slug>` で plan と tasks.json を生成するよう案内して停止する。

通常実行では `Skill(goalflow-viz)` を起動して可視化する。skill は次を実行し、graph-data を融合し、renderer に注入し、ブラウザを開く:

```bash
node skills/goalflow-viz/fuse.mjs <slug> --open
```

`--watch` が付いた場合は、task-6 で実装される次の watcher を起動し、tasks.json / `.codex-out` / git commit / verify journal の変化に合わせて自動リフレッシュする:

```bash
skills/goalflow-viz/watch.sh <slug>
```

このコマンドは read-only / 非侵襲の可視化コマンドであり、exec の挙動・コスト・性能には触れない。書き込みは `.goalflow/viz/<slug>.html` の生成に限る。
