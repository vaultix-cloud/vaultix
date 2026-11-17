#!/bin/sh
# Plants one bug at a time in vx-recover and checks the drills catch it. Run through the disposable database:
#   node scripts/with-test-postgres.mjs -- sh scripts/mutation-recover.sh
# Each mutation is checked to have changed the file, so "all pass" can never mean "nothing was mutated".
cd "$(dirname "$0")/../kernel/foundation/recover" || exit 2
for f in archive anchor; do cp "src/$f.rs" "/tmp/vx-recover-$f.orig"; done
restore_all() { for f in archive anchor; do cp "/tmp/vx-recover-$f.orig" "src/$f.rs"; done; }
trap restore_all EXIT
run() { (cd ../.. && cargo test -p vx-recover --test recover 2>&1 | grep -E "^test .*FAILED|test result" | head -4); }
mutate() {
  label=$1; file=$2; expr=$3
  restore_all
  sed -E -i "$expr" "src/$file.rs"
  if diff -q "/tmp/vx-recover-$file.orig" "src/$file.rs" >/dev/null; then echo "== $label: !! the mutation did not change the file"; return; fi
  echo "== $label"; run
}
echo "== baseline"; run
mutate "snapshot not repeatable-read" archive 's/BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY/BEGIN ISOLATION LEVEL READ COMMITTED READ ONLY/'
mutate "chain verification skipped" archive 's/vx_audit::verify_on\(&mut tx, &head\.chain\)\.await\.map_err/Ok::<i64, vx_audit::AuditError>(0).map_err/'
mutate "non-empty target allowed" archive 's/if any \{/if any \&\& false {/'
mutate "sequences not repaired" archive 's/for \(table, column\) in serials \{/for (table, column) in serials.into_iter().take(0) {/'
mutate "row counts not checked" archive 's/if rows != entry\.rows \{/if false {/'
mutate "heads not compared" archive 's/if heads\(&mut tx\)\.await\? != manifest\.heads \{/if false {/'
mutate "anchor signature ignored" anchor 's/ \|\| mac\(ring, anchor\.format, &anchor\.at, &anchor\.heads\) != anchor\.mac//'
mutate "anchor fork ignored" anchor 's/if stored\.map\(hex::encode\)\.as_deref\(\) != Some\(head\.hash\.as_str\(\)\) \{/if false {/'
mutate "anchor rollback ignored" anchor 's/if seq < head\.seq \{/if false {/'
restore_all
echo "== restored"; run
