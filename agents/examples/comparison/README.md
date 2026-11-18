# The comparison

The same refund policy, written once as prose (`policy.md`), two ways
over the same shop and chat:

|                        | the compiled desk                                                                                                                              | the agent loop                                    |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| the policy             | `../workflows/refund-desk.cern.md`, its sentences                                                                                              | `policy.md`, pasted into a system prompt          |
| the code               | none written by hand: the compile wrote it from the sentences, gated it and proved it live                                                     | `loop/refund-loop.ts`, written by hand            |
| lines                  | 23 lines of spec                                                                                                                               | about 200 lines of TypeScript, plus the SDK       |
| what runs the decision | two bounded judgments (what is asked, whether the item is unused) recorded in the journal; the thirty days, the amount and the refund are code | the model, choosing tools turn by turn            |
| the refund made once   | the journal and the shop's own key                                                                                                             | an idempotency key and a state file, by hand      |
| a crash mid-case       | the call resumes from its journal, judgments never re-asked                                                                                    | the state file is reloaded, the model asked again |
| the reply              | drafted on `reply.md`                                                                                                                          | drafted on the same template in the prompt        |
| a new rule             | one sentence, one amend                                                                                                                        | a prompt edit and a rerun of every case by hand   |

Both answer the storefront the same shape: a decision, a reply, and
the refund's id and amount when one was made.

## What is not claimed

The compiled desk's judgments are the model's too: a fresh case can
read differently on two runs. What the language records and reuses,
it never re-asks; what it computes, it never asks at all. The
comparison of the two by measurement, fifty cases run eight times on
the same seeded shop, the pass rate on the case's checks, the policy
violations, the tokens and the dollars, a case interrupted mid-run,
follows in phase one with its report beside this page and its
baseline open to improvement.
