#!/bin/bash
# 単体テストをまとめて実行する。使い方: bash tests/run_unit.sh  (prompt_timeout / timer_prompt は DB を使うので DATABASE_URL が要る)
cd "$(dirname "$0")/.."
export DATABASE_URL="${DATABASE_URL:-postgres://localhost/salvado_dev}"
bad=0
for t in tests/*.test.js; do
  out=$(node "$t" 2>&1); code=$?
  p=$(echo "$out" | grep -c "^PASS"); f=$(echo "$out" | grep -c "^FAIL")
  r=$(echo "$out" | grep "^RESULT" | tail -1)
  if [ $code -ne 0 ] || [ "$f" != "0" ] || echo "$r" | grep -q FAIL; then bad=1; mark="NG"; else mark="ok"; fi
  printf "%-4s %-40s PASS=%-3s FAIL=%-3s %s\n" "$mark" "$(basename "$t")" "$p" "$f" "$r"
done
[ $bad -eq 0 ] && echo "ALL OK" || echo "SOME FAILED"
exit $bad
