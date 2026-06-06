#!/usr/bin/env python3
"""dme skill のトリガー精度を測るハーネス。

各クエリに対し、skill の description + 現実のトリガー機構ルーブリックを judge に与え、
TRIGGER / NO_TRIGGER を reps 回判定させ、should_trigger ラベルと照合する。
"""
import argparse, json, subprocess, sys
from concurrent.futures import ThreadPoolExecutor, as_completed

JUDGE_TEMPLATE = """You are deciding whether Claude Code would *consult* a particular Skill while handling a user's message.

How skill triggering actually works (important): Claude sees each skill's name + description and consults a skill ONLY when the task is non-trivial AND matches the description's scope. Simple one-step actions, factual lookups, mechanical edits, and questions with a single definite answer do NOT trigger a skill even if they share keywords with it — Claude handles those directly. Always honor the description's stated exclusions.

SKILL name: {name}
SKILL description:
\"\"\"
{description}
\"\"\"

USER MESSAGE:
\"\"\"
{query}
\"\"\"

Would Claude consult the "{name}" skill for this message? Weigh both the description's positive scope and its exclusions, and the triggering rule above.
Answer with EXACTLY one token on the first line: TRIGGER or NO_TRIGGER.
On the second line, give a brief (<=15 word) reason."""


def judge_once(name, description, query, model):
    prompt = JUDGE_TEMPLATE.format(name=name, description=description, query=query)
    try:
        out = subprocess.run(
            ["claude", "-p", prompt, "--model", model],
            capture_output=True, text=True, timeout=180,
        )
    except subprocess.TimeoutExpired:
        return ("ERROR", "timeout")
    text = (out.stdout or "").strip()
    first = text.splitlines()[0].upper() if text else ""
    reason = text.splitlines()[1].strip() if len(text.splitlines()) > 1 else ""
    if "NO_TRIGGER" in first or "NO TRIGGER" in first:
        return ("NO_TRIGGER", reason)
    if "TRIGGER" in first:
        return ("TRIGGER", reason)
    return ("UNPARSED", text[:120])


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--eval-set", required=True)
    ap.add_argument("--desc-file", required=True)
    ap.add_argument("--model", default="claude-sonnet-4-6")
    ap.add_argument("--reps", type=int, default=3)
    ap.add_argument("--out", required=True)
    ap.add_argument("--workers", type=int, default=8)
    args = ap.parse_args()

    data = json.load(open(args.eval_set))
    name = data["skill_name"]
    evals = data["evals"]
    description = open(args.desc_file).read().strip()

    jobs = []
    for i, ev in enumerate(evals):
        for r in range(args.reps):
            jobs.append((i, r, ev["query"], ev["should_trigger"]))

    results = {i: {"query": evals[i]["query"], "should_trigger": evals[i]["should_trigger"],
                   "verdicts": [], "reasons": []} for i in range(len(evals))}

    with ThreadPoolExecutor(max_workers=args.workers) as ex:
        fut = {ex.submit(judge_once, name, description, q, args.model): (i, r)
               for (i, r, q, st) in jobs}
        for f in as_completed(fut):
            i, r = fut[f]
            verdict, reason = f.result()
            results[i]["verdicts"].append(verdict)
            results[i]["reasons"].append(reason)

    # スコアリング
    per_query = []
    correct = 0
    for i in range(len(evals)):
        v = results[i]["verdicts"]
        trig = sum(1 for x in v if x == "TRIGGER")
        n = len(v)
        rate = trig / n if n else 0.0
        # 多数決で判定
        decided = "TRIGGER" if rate >= 0.5 else "NO_TRIGGER"
        expected = "TRIGGER" if results[i]["should_trigger"] else "NO_TRIGGER"
        ok = decided == expected
        correct += ok
        per_query.append({
            "idx": i, "query": results[i]["query"],
            "expected": expected, "decided": decided, "trigger_rate": round(rate, 2),
            "ok": ok, "verdicts": v, "reasons": results[i]["reasons"],
        })

    acc = correct / len(evals) if evals else 0.0
    summary = {
        "model": args.model, "reps": args.reps,
        "n": len(evals), "correct": correct, "accuracy": round(acc, 3),
        "mismatches": [q for q in per_query if not q["ok"]],
        "per_query": per_query,
    }
    json.dump(summary, open(args.out, "w"), ensure_ascii=False, indent=2)

    # コンソール要約
    print(f"model={args.model} reps={args.reps} accuracy={acc:.1%} ({correct}/{len(evals)})")
    print("--- mismatches ---")
    for q in per_query:
        if not q["ok"]:
            print(f"[{q['idx']:02d}] expect {q['expected']:11s} got {q['decided']:11s} "
                  f"rate={q['trigger_rate']:.2f} | {q['query'][:48]}")
            for rr in q["reasons"]:
                print(f"        ↳ {rr[:80]}")
    if all(q["ok"] for q in per_query):
        print("(none — 全問正解)")


if __name__ == "__main__":
    main()
