#!/usr/bin/env bash
# codex exec を wall-clock 有界化する PreToolUse hook。macOS に timeout/gtimeout が無いため perl ラッパーで rewrite。非該当・エラー時は fail-open。詳細: ~/.claude/docs/plans/goal-exec-codex-large-task-hang.md

input="$(cat)"

if [ ! -x /usr/bin/jq ]; then
  exit 0
fi

tool_name="$(printf '%s' "$input" | /usr/bin/jq -r '.tool_name // empty' 2>/dev/null)"
if [ $? -ne 0 ]; then
  exit 0
fi

command="$(printf '%s' "$input" | /usr/bin/jq -r '.tool_input.command // empty' 2>/dev/null)"
if [ $? -ne 0 ]; then
  exit 0
fi

if [ "$tool_name" != "Bash" ]; then
  exit 0
fi

# 先頭の空白（改行含む）を除去
trimmed="${command#"${command%%[![:space:]]*}"}"
case "$trimmed" in
  "codex exec "*|"codex exec") : ;;   # 先頭の命令が codex exec のときだけ通す
  *) exit 0 ;;                          # それ以外は no-op（fail-open）
esac

case "$command" in
  "perl -e "*)
    exit 0
    ;;
esac

perl_wrap='my $t=shift@ARGV;my $p=fork;if(!defined$p){exit 127}if(!$p){exec@ARGV;exit 127}$SIG{ALRM}=sub{kill 15,$p;sleep 2;kill 9,$p;exit 124};alarm $t;waitpid($p,0);exit($?>>8)'
new_command="perl -e '$perl_wrap' 300 $command"
ladder='codex exec is wall-clock-bounded to 300s by codex-exec-guard. On exit 124 (timeout) or suspected rate-limit (TPM/RPM) exhaustion, DEGRADE before retry: (1) lower model_reasoning_effort xhigh->high->medium, (2) split into 2-3 files, (3) drop -c service_tier="priority", (4) last resort Opus-direct for mechanical no-logic edits. Root cause: xhigh reserves huge tokens; cumulative throttle -> 429 -> silent backoff.'

printf '%s' "$input" | /usr/bin/jq --arg cmd "$new_command" --arg ctx "$ladder" \
  '{hookSpecificOutput:{hookEventName:"PreToolUse",permissionDecision:"allow",updatedInput:(.tool_input + {command:$cmd}),additionalContext:$ctx}}' 2>/dev/null

exit 0
