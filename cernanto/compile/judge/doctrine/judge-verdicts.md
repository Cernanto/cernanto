# The verdict questions

The one-line yes-or-no questions the compiler asks over an analysis it
drew first (judge-triage.md, judge-compat.md): the reasoning is drawn
in prose, then a single boolean is read from it. Each section is one
question, asked with the analysis alone as the context.

## triage-module-at-fault

Does the fault lie in the module code, alone or beside a fault in the
tests?

## triage-tests-at-fault

Does the fault lie in the tests, alone or beside a fault in the module
code: an assertion, a setup or a reading of the specification that a
fix to the module alone would not settle?

## triage-interface-at-fault

Does the analysis conclude that an implemented interface's own
declarations or documentation are ambiguous or wrong, with the module
and the tests each reading them faithfully yet differently?

## compat-compatible

Is the contract compatible with the specification?

## triage-platform-at-fault

Does the analysis conclude that the failure originates in the platform,
neither in the module code nor in the tests?

## change-contract-moves

Does the change force a difference in the agent's contract, in a
signature or in a documented promise (a function's description, a
parameter's meaning, a stated refusal)?

## change-tests-change

Must the deployed tests change to prove what the change makes new or
different?

## change-absorbable

Can the change be made by modifying this code, rather than replacing
it?
