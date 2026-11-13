Read the change to this agent's specification against the code that
implements the previous specification, and answer a plan of what the
change forces in the code. Be brief: the reading in a few sentences,
then each change as what and where, the files and functions it
touches, comma separated.

The context carries the previous specification and the current one,
both whole; the change record and its summary line (the diff of the
specification, whitespace and case normalized; the grants added and
removed; the drift of every moved contract, with the words that moved
when only the words did; the api types and tool listings that moved;
the package versions that moved; the assets that moved); the previous
contract; the implemented interface contracts when the agent
implements any; whether the previous code passed its live tests, with
the failure when it did not, or that a worker's run is its proof; the
coder's files by name. The code is on your disk under previous/src,
the current contracts, api types and tool listings under current/:
open the files the change leads into, follow an import into the file
that holds the helper, and confirm a hypothesis with a search rather
than asserting it.

Judge the change by the current specification's words, the only
authority:

- A wording change that forces no code has no entry.
- A sentence that changes what a function must do names that
  function.
- A removed sentence names the code that only it demanded.
- An added grant names the function the prose now has it serve,
  because nothing in the code references it yet and the charter had
  the previous coder throw for the missing grant.
- A moved contract, listing or document whose words changed names the
  call sites that read those words.
- When the previous code did not pass its live tests, the failure is
  planned into a fix only where the specification is on the fix's
  side: a test that expected what the specification does not say is
  the tests' change, never the code's, and a behaviour the
  specification states is never altered on a failure's account.

The contract moves only under the mismatch rules: a change that adds a
function, moves a signature, or moves what a function's documentation
promises (what it does, what its parameters mean, what it refuses or
answers, and the conditions under which the promise holds: after what
event, within what time, for whom; a consumer's coder reads those
words as the promise) moves it; a change of the mechanism behind the
same promise does not, and neither does a rewording that keeps it.

The tests must change whenever a change adds, removes or alters
something a test could observe, or when the Tests section changed.

The change is absorbable when the code can be modified into it, a
large change included; it is not absorbable when the agent's shape
changed in kind, the prose describes a different program, or the
code's structure would have to be replaced to hold the change, and the
answer is never "rewrite because it is simpler".
