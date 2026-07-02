#!/usr/bin/env python3
"""dme skill の「挙動忠実度」(軸b)を測るハーネス。

trigger_eval.py が「出るべき時に出るか(軸a)」を測るのに対し、こちらは
「出たあと v1 契約通りに振る舞うか(軸b)」を測る。

各問題に対し:
  1. executor … SKILL.md を適用させて dme を実走させ、出力を得る
  2. judge    … その出力が v1 契約の観点を満たすかを JSON で採点する
require の観点が全て true（premise_trap なら premise_surfaced も）で pass。
"""
import argparse, json, re, subprocess, sys
from concurrent.futures import ThreadPoolExecutor, as_completed

# ネストした `claude -p` は親セッションの MCP 設定を全て初期化しようとし、
# サーバ数次第で1呼び出し数分かかる（2026-07-02 実測: MCP 有効 5分45秒 → 無効 7秒）。
# eval はプレーンテキスト応答しか要らないので MCP を明示無効化する。
MCP_OFF = ["--strict-mcp-config", "--mcp-config", '{"mcpServers":{}}']

EXEC_TEMPLATE = """あなたは次の「スキル」に厳密に従って回答するアシスタントです。
スキルの出力契約（## スコープ＋観察 / ## 構造・流れの仮説 / ## 検証—ズレ / ⚖️ moat / → あなたが決めるのはここ）に沿って答えてください。

==== SKILL ====
{skill}
==== /SKILL ====

ユーザの相談:
\"\"\"
{query}
\"\"\"
"""

JUDGE_TEMPLATE = """あなたは dme スキルの「挙動」を採点する審査員です。dme は構造判断スキルで、v1契約は次の観点を要求します。

- loop: 出力が3モード（①スコープ+観察 / ②構造・流れの仮説 / ③検証—ズレ）の構造を踏み、末尾に「⚖️ moat」と「→ あなたが決めるのはここ」を持つ。
- moat_left: ①どこを切るか・③何を基準にズレを見るか、を AI が確定せず人間に返している（決め切っていない）。
- multi_hypo: ②で構造/流れの仮説を複数出している。
- premise_surfaced: 与件（要件・前提）が怪しい場合に「本当にこの要件でいいのか / 本当に求めるものは何か」を ⚖️ で人間に上げている。
- recursion_visible: ある論点を一段掘り下げてから戻る（再帰/降下→浮上）挙動が見えるか。※あれば加点、無くてもfail扱いにしない観察項目。

ユーザの相談:
\"\"\"
{query}
\"\"\"

採点対象の出力:
\"\"\"
{output}
\"\"\"

各観点を true/false で判定し、**JSONのみ**を出力してください（前置き・コードフェンス禁止）:
{{"loop": bool, "moat_left": bool, "multi_hypo": bool, "premise_surfaced": bool, "recursion_visible": bool, "notes": "<=25字の総評"}}"""


def run_cli(prompt, model, timeout=600):
    try:
        out = subprocess.run(
            ["claude", "-p", prompt, "--model", model, *MCP_OFF],
            capture_output=True, text=True, timeout=timeout,
        )
    except subprocess.TimeoutExpired:
        return ""
    return (out.stdout or "").strip()


def parse_json(text):
    if not text:
        return None
    m = re.search(r"\{.*\}", text, re.DOTALL)
    if not m:
        return None
    try:
        return json.loads(m.group(0))
    except json.JSONDecodeError:
        return None


def evaluate_one(item, skill, exec_model, judge_model, timeout=600):
    out = run_cli(EXEC_TEMPLATE.format(skill=skill, query=item["query"]), exec_model, timeout)
    if not out:
        return {"id": item["id"], "error": "executor empty", "output": "", "scores": None}
    verdict = parse_json(run_cli(
        JUDGE_TEMPLATE.format(query=item["query"], output=out), judge_model, timeout))
    return {"id": item["id"], "output": out, "scores": verdict,
            "require": item["require"], "premise_trap": item.get("premise_trap", False)}


def passed(r):
    s = r.get("scores")
    if not s:
        return False
    for k in r["require"]:
        if not s.get(k):
            return False
    if r["premise_trap"] and not s.get("premise_surfaced"):
        return False
    return True


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--eval-set", required=True)
    ap.add_argument("--skill-file", required=True)
    ap.add_argument("--exec-model", default="claude-sonnet-4-6")
    ap.add_argument("--judge-model", default="claude-sonnet-4-6")
    ap.add_argument("--out", required=True)
    ap.add_argument("--workers", type=int, default=4)
    ap.add_argument("--timeout", type=int, default=600)
    args = ap.parse_args()

    data = json.load(open(args.eval_set))
    skill = open(args.skill_file).read().strip()
    evals = data["evals"]

    results = []
    with ThreadPoolExecutor(max_workers=args.workers) as ex:
        fut = {ex.submit(evaluate_one, it, skill, args.exec_model, args.judge_model, args.timeout): it["id"]
               for it in evals}
        for f in as_completed(fut):
            results.append(f.result())
    results.sort(key=lambda r: r["id"])

    n = len(results)
    npass = sum(passed(r) for r in results)
    summary = {
        "exec_model": args.exec_model, "judge_model": args.judge_model,
        "n": n, "passed": npass, "pass_rate": round(npass / n, 3) if n else 0.0,
        "results": results,
    }
    json.dump(summary, open(args.out, "w"), ensure_ascii=False, indent=2)

    print(f"exec={args.exec_model} judge={args.judge_model}  pass {npass}/{n}")
    print("--- per problem ---")
    for r in results:
        s = r.get("scores") or {}
        if r.get("error"):
            print(f"[{r['id']:12s}] ERROR {r['error']}")
            continue
        flags = " ".join(f"{k}={'T' if s.get(k) else 'F'}" for k in
                         ["loop", "moat_left", "multi_hypo", "premise_surfaced", "recursion_visible"])
        print(f"[{r['id']:12s}] {'PASS' if passed(r) else 'FAIL'}  {flags}  | {s.get('notes','')}")


if __name__ == "__main__":
    main()
