Analyze whether this test failure originates in the module code or in
the test code. The specification is the only shared truth: the module
and the tests were written independently from it, and the guilty side
is the one that does not match what the specification says. Examine
the error details, compare expected against actual behavior, and
decide which side violates the specification. Identify the specific
function, handler or test case that needs repair and describe the
exact fix required. Be brief: a verdict, the one piece of evidence
that decides it, and the fix; do not restate the code, the tests or
the trace.

The evidence, and how to read it:

- The trace of the run, when the failure carries it (the lines after
  "Live trace of the tester" or "Live trace of the agent"), is the
  record of fact: it shows what the agent actually did, every call it
  made with its arguments and the answer it got, every judgment it
  asked, every step, every pause, and what it finally answered. Judge
  the module by what the trace shows it did, and the test by whether
  what it expected is what the specification promises.
- The contracts of the dependencies the failing path called, when the
  context carries them: judge the module's use of them against their
  words. The callee's own trace, when it is there: judge whether the
  dependency answered outside its promise; the module is not at fault
  for an answer its dependency never promised.
- This compile's earlier verdicts and fixes, when the context carries
  them: do not send the compile back and forth between the sides. A
  side already fixed for the same failure is evidence that the other
  side, or the platform, is at fault.
- The code, the tests and the traces are on your disk when the prompt
  names their folders: open the file the failing assertion leads into
  and confirm a hypothesis with a search rather than asserting it.

The four origins a failure can have:

1. The module: its behavior contradicts an explicit statement of the
   specification. A specification that states what a function returns
   (a number, a date, a list of names) determines that shape: a module
   that answers an object wrapping the value, or a string where a date
   was promised, contradicts the specification, and a test asserting
   the stated shape is right. A trace that ends inside the module's
   own code, with no call to a dependency or to the plane pending, is
   the module's too: it stalled there, in a request to the world it
   never bounded or a wait it never ended, and a rerun of the same
   tests would stall the same way.
2. The tests: an assertion, a setup or a reading of the specification
   that a fix to the module would not settle. A test that asserts an
   exact value the specification does not determine has invented a
   reading: the tests are the side to fix, to assert only what every
   faithful reading of the specification shares. A failure the tests'
   own code raised is the tests' fault whatever its words say about
   the platform: a test reaches an agent only through the stubs under
   its `agents/` folder, so a name the tests wrote themselves that
   nothing answers to, or a road the tests took that the stubs do not
   give them, is the tests' to fix.
3. The interface, when the context carries implemented interface
   contracts (the shared surface this agent implements): the
   interface's own declarations or documentation are ambiguous or
   wrong, with the module and the tests each reading them faithfully
   yet differently. Say so explicitly when that is the finding: no fix
   to the module or the tests can settle a disagreement the
   interface's words created; the interface's specification is the
   side to fix, and the whole family recompiles from it.
4. The platform: the trace shows a dependency answering
   target-unavailable or the plane refusing, a tester whose own
   generation was not yet active, a credential the plane lacks, or any
   failure that neither the module's code nor the tests' assertions
   caused. Say so: the fault is the platform's, no fix to either side
   can settle it, and the compile reruns the cycle.

When both sides plausibly match the specification, the specification
is ambiguous: say so, and treat the module as guilty only if its
behavior contradicts an explicit statement.

When the failure is the type checker's findings over the test files
and not a run, each finding settles from its own words, the line it
names and the declaration that line touches: a finding about what the
tests declared for themselves (the type of their own variable, a name
they shadowed, an import they chose) is the tests' to fix whatever the
module does, and a finding where the tests use the module's declared
surface as the specification promises while the declarations say
otherwise is the module's. Read the finding and its line first and
decide when they settle it.
