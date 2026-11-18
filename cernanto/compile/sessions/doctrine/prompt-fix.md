# The fix turns

What a session is told when the compile comes back to it: the failed
gates' words, a triage verdict, a live failure with its trace. Each
turn ends with one instruction, apply the report and stop; the toolbox
rule (no node, npm or tsc in the shell) and the fix discipline (change
the lines the report names, never rewrite) are the charter's, which
rides every turn. The compile fills `{{report}}`, `{{analysis}}`,
`{{failure}}` and the words with its own text. A blank line inside a
section is a paragraph break the session sees; a single line break is
the formatter's.

## gate-failed

The {{gate}} gate failed:

## code-gates

Fix the implementation so every gate passes, then stop: the compile
re-runs tsc, the lint rules and its scans over exactly what you wrote
and comes back only if something still fails.

## tests-gates

The tests failed the compile's checks.

{{report}}

Fix the tests so they type-check and pass the checks, then stop: the compile
re-runs tsc and its scans over exactly what you wrote and comes back
only if something still fails. When a finding names its own cure (a
declaration it says lacks a type annotation, a name it says is
missing), apply that cure first, at the line the finding names, before
any theory of your own about the cause.

## heal

The fix failed the compile's checks:

{{report}}

Fix the {{what}} so they type-check and pass the checks, then stop: the
compile re-runs the gates over exactly what you wrote and comes back only
if something still fails.

## heal-what-code

code

## heal-what-tests

tests (src/\*.test.ts)

## reused-tests-checks

The checks failed:

## type-check-triage-code

The generated tests cannot type-check against the module contract, and
triage found the module at fault:

{{analysis}}

Fix the module so its contract matches the specification, then stop:
the compile re-runs the gates over exactly what you wrote and comes back
only if something still fails.

## contract-corrected

The module contract was corrected. Fix the tests to type-check against it,
then stop: the compile re-runs the gates over exactly what you wrote.

## live-code

The tester failed against the real environment. The failure:

{{failure}}

Triage analysis:

{{analysis}}

Fix the implementation to match how the real systems actually behave,
then stop: the compile re-runs the gates over exactly what you wrote,
redeploys and runs the tests again.

## live-tests

The tests failed against the real environment and triage found the
tests at fault. The failure:

{{failure}}

Triage analysis:

{{analysis}}

Fix the tests (src/\*.test.ts) to check what the specification actually
promises, then stop: the compile re-runs the gates over exactly what you
wrote, redeploys and runs the tests again.

## evidence-tester

Live trace of the tester (what it asked the agent and what came back):

## evidence-agent

Live trace of the agent (what it did in the environment):

## timeout-run

the tester did not finish within {{duration}}; suspect an endless loop
in a deployed handler, or a call that never completes (a dependency
call retrying forever); its run may still be going in the
environment (cernanto calls)

## timeout-ask

the run has waited {{duration}} on a credential ask the operator has
not answered; it stays parked in the environment and resumes when the
credential lands
