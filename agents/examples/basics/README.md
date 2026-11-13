# The basics

Seventeen agents, one lesson each, in the order to read them: a job you
recognize, and beside it the one thing of the language it shows. Every
spec sits beside its compiled package under `.cern/`, so `cernanto
deploy` lands the whole folder without a compile, and only a spec you
edit is compiled.

| agent        | type      | the job                                         | the lesson                                                 |
| ------------ | --------- | ----------------------------------------------- | ---------------------------------------------------------- |
| `counter`    | service   | check that the install works                    | memory that outlives a call, and calls served side by side |
| `team-notes` | task      | answer a question from the team handbook        | files of its own and a judgment over them                  |
| `triage`     | task      | route a support request                         | a judgment with a fixed set of answers, and a wait         |
| `fact-check` | task      | check a claim against the web                   | search and a judgment, with an honest "uncertain"          |
| `facts`      | task      | check every claim a text makes                  | using an agent without naming it                           |
| `approval`   | service   | ask a person and wait for the answer            | a call that parks until a person decides                   |
| `ping`       | job       | run a command-line tool                         | a job: live answers, run again from the start              |
| `hook`       | task      | take an alert from a system that posts webhooks | a webhook, and an agent that knows its own name            |
| `notice`     | task      | announce an incident on the team's board        | a mock: the one dependency a verify must never exercise    |
| `clock`      | worker    | a program on its own schedule                   | a worker, whose code keeps its own time                    |
| `greeting`   | interface | one job, several providers                      | a contract alone                                           |
| `formal`     | module    | a provider that is a line of code               | code linked into whoever uses it                           |
| `usher`      | task      | a provider that uses other agents               | an implementor that calls over the wire                    |
| `welcome`    | task      | pick the provider when the call is made         | choosing an implementor at run time, by an argument        |
| `shortlist`  | task      | the articles that answer a question, best first | two decisions over a list: the ones that pass, the best    |
| `severity`   | task      | rate an incident and page at a threshold        | a degree on a scale, compared and weighed in code          |

Every command below runs from the `agents/` folder against the dev
plane (`cernanto dev up`). Each section shows the spec, a call and
its answer, then one sentence to change: edit the spec, deploy it, and
call it again for the changed answer. A deploy of an edited spec is an
amend, two or three minutes: the change is judged in words, the code
amended against the previous compile, the tests updated where the promise
moved, and the result proved live before it lands. Put the sentence
back and deploy once more to undo an exercise.

A spec is plain English with a few labeled lines: `Uses:` grants what
the agent works with, as `team-notes` and `triage` do, `Type:` says
the kind when it is not a task, as `counter` and `ping` do, and
`## Tests` opens the sentences about testing, as `notice` has. Each
spec ends with its terms, the two labels under `## License`.

`cernanto contract examples/basics/<agent>` prints an agent's functions,
what each takes and answers, and the `cernanto call` line that calls
it: that is how you find the names used below, and the ones your edit
adds. `cernanto code examples/basics/<agent>` prints the code the compile wrote,
and `cernanto tests examples/basics/<agent>` its tests. `cernanto trace
examples/basics/<agent>` prints its latest call as a conversation. The outputs shown are what a pipe or `-q` gets; at a
terminal, `cernanto call` first prints the call's conversation,
then its answer and a `cernanto trace` command for it.

## counter, a service: is the install working?

```
Hand out queue numbers from one count this agent keeps for everyone
who calls it. Each call gets the next number: 1, then 2,
then 3, and so on. Never hand out the same number twice, even when
calls arrive together.

Type: service
```

A service keeps memory for the life of its deployed version and serves
its calls side by side. That is why this is a service: the number lives
in its memory, and "never twice, even together" is what a service is
for. The spec says so on its `Type:` line, and its first sentence says
what that means, "one count this agent keeps for everyone who calls
it"; the compile prints the line back: `reads a service, from the
Type: label`. A spec without the line is a task.

```
$ cernanto deploy examples/basics/counter
$ cernanto call examples/basics/counter next
1
$ cernanto call examples/basics/counter next
2
```

The compile wrote its tests from the three sentences: one calls it three
times in a row, the other five times at once and checks that the five
numbers are distinct and continue the count. `cernanto tests
examples/basics/counter` shows them.

Try a crash. The spec says nothing about one: carrying on is what a
service does. The counter's process runs from a folder whose name ends
in `basics-counter-s<port>`; kill it, and the plane brings it back.
It carries on, because a service restores its memory by replaying the
calls it took, and a call made while it is coming back waits and is
taken the moment it serves:

```
$ cernanto call examples/basics/counter next
3
$ kill -9 $(lsof -c node 2>/dev/null | awk '$4 == "cwd" && /basics-counter-s/ {print $2}')
$ cernanto call examples/basics/counter next
4
```

On Windows the process is found by the folder on its command line and
ended with the system's own kill, in PowerShell:

```powershell
PS> taskkill /F /PID (Get-CimInstance Win32_Process -Filter "Name='node.exe' AND CommandLine LIKE '%basics-counter-s%'").ProcessId
```

A new version starts over at 1: a redeploy of a changed spec is a new
generation with fresh memory. Anything that must
outlive a redeploy belongs in an agent that owns storage.

**Change one sentence.** Start the count at a hundred: `1, then 2, then
3` becomes `100, then 101, then 102`. The deploy is an amend of the
previous compile, and the new version begins where the sentence says:

<!-- lab edit examples/basics/counter.cern.md
Each call gets the next number: 1, then 2,
then 3, and so on.
=>
Each call gets the next number: 100, then 101,
then 102, and so on.
-->

```
$ cernanto deploy examples/basics/counter
$ cernanto call examples/basics/counter next
100
```

## team-notes, a task over its own files: a question for the handbook

```
Given a question, answer it from the team notes and, at the same time,
name the notes that support the answer. If the notes do not contain the
answer, say so. The team notes are the files in the notes folder, and
the notes that bear on the question are chosen with cernanto/decision, and the answer is written with cernanto/llm over them.

Uses:

- file:team-notes/notes/
- cernanto/decision
- cernanto/config
- cernanto/llm
```

Three markdown notes about a fictional company ride with the agent
under `team-notes/notes/`. The spec grants the folder as
`file:team-notes/notes/`, a path from the spec's folder, and says
"the notes folder" where the work needs it; the compile prints the
line back:

```
examples/basics/team-notes  plan  reads Uses: file:team-notes/notes/, cernanto/decision, cernanto/config, cernanto/llm
```

The agent reads the notes, asks the plane's decision engine which of
them bear on the question, and the language model for the answer
from those notes, never its own memory of the world.

```
$ cernanto call examples/basics/team-notes ask question="How many days of leave do I get a year?"
{"answered":true,"answer":"25","notes":["holidays.md"]}
$ cernanto call examples/basics/team-notes ask question="Who approves spending above five thousand?"
{"answered":true,"answer":"Dana Swope","notes":["team.md"]}
$ cernanto call examples/basics/team-notes ask question="What is the office wifi password?"
{"answered":false,"answer":"The team notes do not contain the answer to this question.","notes":[]}
```

Replace the notes with your own handbook and deploy; the spec does not
change. (The helpdesk in `examples/workflows/` is this agent with a chat bot in
front of it.)

**Change one sentence.** Answer with the note's own words instead of a
summary:

<!-- lab edit examples/basics/team-notes.cern.md
Given a question, answer it from the team notes and, at the same time,
=>
Given a question, answer it with the sentence of the team notes that
answers it, word for word, and, at the same time,
-->

```
$ cernanto deploy examples/basics/team-notes
$ cernanto call examples/basics/team-notes ask question="How many days of leave do I get a year?"
{"answered":true,"answer":"Twenty-five days a year, taken in whole or half days, booked in the calendar and approved by the manager.","notes":["holidays.md"]}
```

## triage, a judgment and a wait: route a support request

```
Uses: cernanto/decision, cernanto/llm, cernanto/config

Given a support message and a number of minutes: classify the message
as billing, technical or account access, and pick out the order id
when it names one, both at the same time. Wait the given minutes, then
answer the category and the order id.

Decisions are made with cernanto/decision on the engine the configuration
names under `cernanto/decision/default`, `cernanto/decision/llm` when it names
none, read through cernanto/config.
```

A decision with a fixed set of answers: the code asks the plane's
decision engine which of the three it is, and the answer is one of the
three words the spec names, never free text. "Both at the same time" is the one word about how:
the classification and the order id are independent judgments, and
without it the code asks them one after another.

```
$ cernanto call examples/basics/triage triage message="The reports page shows an error every time I open it" minutes:=0
{"category":"technical","orderId":null}
$ cernanto call examples/basics/triage triage message="I was charged twice for order A-1042" minutes:=0
{"category":"billing","orderId":"A-1042"}
```

**Change one sentence.** A message that fits none of the three should
not be forced into one. Add a fourth answer:

<!-- lab edit examples/basics/triage.cern.md
as billing, technical or account access, and pick out the order id
=>
as billing, technical, account access or other, and pick out the order id
-->

```
$ cernanto deploy examples/basics/triage
$ cernanto call examples/basics/triage triage message="Do you sell gift cards?" minutes:=0
{"category":"other","orderId":null}
```

The wait is there for an experiment, not for support. Ask with one
minute, and while it waits kill the triage process the way you killed
the counter's:

```
$ cernanto call examples/basics/triage triage message="I was charged twice for order A-1042" minutes:=1 &
$ sleep 25; kill -9 $(lsof -c node 2>/dev/null | awk '$4 == "cwd" && /basics-triage-s/ {print $2}')
{"category":"billing","orderId":"A-1042"}
```

It answered after 79 seconds, the same as an uninterrupted run. A
task's call resumes from its journal: the judgments were recorded, so
the replay reads them instead of asking again, and the timer finishes
what was left of the minute. The trace shows the judgments made once,
before the crash, then the sleep, then the reply:

<details>
<summary>the trace of the interrupted call</summary>

```
$ cernanto trace examples/basics/triage
Triage · Triage  ok  1m19s  examples_basics_triage:20074:c-4ba1715a-60d1-446e-b4f9-57620af3da92
2026-09-27 09:59:26

09:59:26  ← Gateway
            Triage
            Message: I was charged twice for order A-1042
            Minutes: 1

09:59:26  → AI
            Classify
            Prompt:  Which kind of support request is this message: billing (charges, payments, invoices, refunds), technical (something not working, errors, bugs), or account access (logging in, passwords, permissions)?
            Classes:
              - billing
              - technical
              - account access
09:59:34  ← AI  7.5s  cernanto_ai:20003:c-4ba1715a-60d1-446e-b4f9-57620af3da92-1
            billing

09:59:34  → AI
            Condition
            Prompt: Does the message name a specific order id (an order number or order identifier)?
09:59:39  ← AI  5.8s  cernanto_ai:20003:c-4ba1715a-60d1-446e-b4f9-57620af3da92-2
            true

09:59:39  → AI
            Concise
            Prompt: What is the order id the message names, exactly as written?
09:59:45  ← AI  5.8s  cernanto_ai:20003:c-4ba1715a-60d1-446e-b4f9-57620af3da92-3
            A-1042

10:00:45  · slept 1m00s

10:00:45  → Gateway  1m19s
            Category: billing
            Order Id: A-1042
```

</details>

## fact-check, search and a judgment: check a claim against the web

```
Uses: cernanto/search, cernanto/decision, cernanto/llm, cernanto/config

Given a claim about the world, check it against published sources.
Answer whether it is true, false or uncertain, and the sources you
used.
```

```
$ cernanto call examples/basics/fact-check factCheck claim="The Great Wall of China is visible from the Moon with the naked eye."
{"verdict":"false","sources":["https://www.snopes.com/fact-check/great-wall-from-moon/","https://factfizz.com/2025/11/08/why-you-cannot-see-the-great-wall-of-china-from-the-moon-and-when-its-visible-from-orbit/","https://www.skyatnightmagazine.com/space-science/can-you-see-great-wall-china-from-space","https://www.aljazeera.com/news/2003/10/17/chinas-spaceman-shatters-a-myth","https://www.nasa.gov/wp-content/uploads/static/history/PDFs/great_wall_less_great_from_space.pdf","https://phys.org/news/2005-05-china-wall-great-view-space.html","https://spacedaily.com/d-the-great-wall-of-china-is-not-actually-visible-from-space-with-the-naked-eye-astronauts-from-apollo-to-the-iss-have-confirmed-it-and-the-popular-myth-that-it-is-predates-space-tra/"]}
```

Its tests prove a true claim (the Eiffel Tower in Paris), a false one
(Sydney as Australia's capital) and an uncertain one (life on Proxima
Centauri b), each with a real search.

**Change one sentence.** Ask for the reason beside the verdict:

<!-- lab edit examples/basics/fact-check.cern.md
Answer whether it is true, false or uncertain, and the sources you
used;
=>
Answer whether it is true, false or uncertain, the sources you used,
and one sentence saying why;
-->

```
$ cernanto deploy examples/basics/fact-check
$ cernanto call examples/basics/fact-check factCheck claim="The Great Wall of China is visible from the Moon with the naked eye."
{"verdict":"false","sources":["https://www.snopes.com/fact-check/great-wall-from-moon/","https://www.skyatnightmagazine.com/space-science/can-you-see-great-wall-china-from-space","https://www.cbc.ca/news/world/great-wall-invisible-from-space-chinese-astronaut-1.504378","https://spacedaily.com/d-the-great-wall-of-china-is-not-actually-visible-from-space-with-the-naked-eye-astronauts-from-apollo-to-the-iss-have-confirmed-it-and-the-popular-myth-that-it-is-predates-space-tra/"],"reason":"The Wall is too narrow and low-contrast to see with the naked eye from the Moon, and it is hard to spot even from low Earth orbit."}
```

`cernanto contract examples/basics/fact-check` now names the third field the
compile added; the name is the coder's choice, the sentence is yours.

## facts, using an agent without naming it: every claim in a text

```
Uses: examples/basics/fact-check, cernanto/decision, cernanto/llm, cernanto/config

Given a text, pick out its claims about the world and rewrite each as
a complete statement that stands on its own. Check the claims at the
same time, and answer the ones that are true.
```

The spec never says "check each claim with the fact checker". It grants
the checker and says what to answer; the compile reads the checker's
contract and calls it once per claim. Restating what the checker does
would be a second copy of its contract, and the two would drift. "At
the same time" is the one word about how: the three checks overlap,
and the call takes as long as the slowest, not the sum.

```
$ cernanto call examples/basics/facts facts text="Mount Everest is the tallest mountain above sea level. It sits on the border of Nepal and China, and it was first climbed in 1935."
["Mount Everest is the tallest mountain above sea level.","Mount Everest sits on the border of Nepal and China."]
```

`cernanto trace examples/basics/facts` shows one call to the fact checker per
claim, each with its own search beneath it.

**Change one sentence.** Keep the sources the checker found for each
true claim:

<!-- lab edit examples/basics/facts.cern.md
same time, and answer the ones that are true;
=>
same time, and answer the ones that are true, each with the sources
that support it;
-->

```
$ cernanto deploy examples/basics/facts
$ cernanto call examples/basics/facts facts text="Mount Everest is the tallest mountain above sea level. It sits on the border of Nepal and China, and it was first climbed in 1935."
[{"claim":"Mount Everest is the tallest mountain above sea level.","sources":["https://kathmandupost.com/national/2020/12/08/it-s-official-mount-everest-is-8-848-86-metres-tall","https://www.britannica.com/place/Mount-Everest","https://www.britannica.com/place/Mount-Everest/The-height-of-Everest","https://education.nationalgeographic.org/resource/mount-everest/","https://en.wikipedia.org/wiki/Mount_Everest","https://en.wikipedia.org/wiki/List_of_highest_mountains_on_Earth"]},{"claim":"Mount Everest sits on the border between Nepal and China.","sources":["https://en.wikipedia.org/wiki/Mount_Everest","https://www.britannica.com/place/Mount-Everest","https://www.chinahighlights.com/tibet/mt-everest/nepal-side-and-china-side.htm","https://www.acethehimalaya.com/where-is-mount-everest-located/","https://www.tibettravel.org/tibet-travel-advice/is-mount-everest-in-china-or-nepal.html","https://www.magicalnepal.com/blog/where-is-mount-everest-located/","https://nepalgatewaytrekking.com/blog/where-is-mt-everest-located","https://www.majestictrailsnepal.com/blogs/does-mount-everest-belong-to-nepal-or-china","https://himalayanecologicaltrek.com/blog/where-is-mount-everest-located"]}]
```

## approval, a call that parks: ask a person and wait

```
A service. Accept an approval request with a name and a time limit in
minutes. Wait for a person to approve or reject it by name, then
answer their decision. If the time limit passes first, answer that no
one decided in time.

Type: service
```

A purchase request, an access request, a deploy: the request parks
until a person decides. A service, because the parked request lives in
its memory and a second call, the person's, must reach the same memory.
Two terminals:

```
$ cernanto call examples/basics/approval requestApproval name="deploy-42" timeLimitMinutes:=5
$ cernanto call examples/basics/approval approve name="deploy-42"
$                                                       # the first terminal answers:
"approved"
```

`reject` is the other half, and a request nobody decides answers when
its limit passes. A parked call costs nothing while it waits; try a
limit of a tenth of a minute and decide nothing:

```
$ cernanto call examples/basics/approval requestApproval name="a pony" timeLimitMinutes:=0.1
"expired"
```

A decision given before its request is kept for the next request of
that name: `approve name="a pony"` now, and a request for the pony
afterwards answers "approved" at once.

**Change one sentence.** Say how long an undecided request waited:

<!-- lab edit examples/basics/approval.cern.md
If the time limit passes first, answer that no one decided
in time.
=>
If the time limit passes first, answer that no one decided
in time, and how long it waited.
-->

```
$ cernanto deploy examples/basics/approval
$ cernanto call examples/basics/approval requestApproval name="a bicycle" timeLimitMinutes:=0.1
{"outcome":"expired","waitedMinutes":0.10008333333333333}
```

## ping, a job: run a command-line tool

```
Each call is one live run of the system's ping command, started over
if it fails part way.
Given a host name, ping it five times. Answer the average round trip
time in milliseconds and how many of the five replies were lost.

Type: job
```

A job runs a live tool whose answers change from run to run, so nothing
in it can be replayed; an interruption runs it again from the start. A
tool that is deterministic, files in and files out, would be a task.

```
$ cernanto call examples/basics/ping ping hostName=one.one.one.one
{"averageMs":10.353,"lost":0}
$ cernanto call examples/basics/ping ping hostName=192.0.2.1
{"averageMs":null,"lost":5}
```

The second address is reserved for documentation and never routed,
which is how the tests prove the losses.

**Change one sentence.** Three pings instead of five:

<!-- lab edit examples/basics/ping.cern.md
Given a host name, ping it five times. Answer the average round trip
time in milliseconds and how many of the five replies were lost.
=>
Given a host name, ping it three times. Answer the average round trip
time in milliseconds and how many of the three replies were lost.
-->

```
$ cernanto deploy examples/basics/ping
$ cernanto call examples/basics/ping ping hostName=192.0.2.1
{"averageMs":null,"lost":3}
```

## hook, a webhook consumer: an alert from a system that posts

```
Uses: cernanto/webhook

When asked for the url, answer the url a provider posts its deliveries
to. When asked for the next delivery, wait for it and answer the value
of its body's "event" field, or "unknown" when the body has none or
that field is not text; the provider's own request gets the same
answer.

## Tests

Ask the agent for its url and for the next delivery, post one there
with a plain http request the way a provider would while the wait is
open, and check that the wait and the response both give the
delivery's event.
```

A backup job, a monitoring tool, a payment provider: systems that tell
you something by posting a webhook. The agent asks the webhook agent
for the url of its own id, which the os module's `agentId()` answers,
and takes its deliveries by waiting for them: the webhook agent hands
every delivery posted there to the call that waits for it, or to the
next call that waits within thirty seconds, and carries that call's
reply back to the provider, whose request waits for it that long.
The url is
on the cloud relay at `hooks.cernanto.com`, the one road a delivery
has into a plane: the plane holds a websocket to the relay, and
nothing listens on your machine. The tests grant nothing; they post
with `fetch`, the way a provider does.

```
$ URL=$(cernanto call examples/basics/hook url -q | tr -d '"')
$ echo "$URL"
https://hooks.cernanto.com/c/<your plane's channel, sixty-four hex characters>/basics-hook
```

Two terminals: one waits for the next delivery, the other is the
provider.

```
$ cernanto call examples/basics/hook nextDelivery
                                                        # parks until a delivery arrives
$ curl -s -X POST -H 'content-type: application/json' -d '{"event":"backup.failed","job":"nightly","id":42}' "$URL"
backup.failed
$                                                       # the first terminal answers:
"backup.failed"
```

<details>
<summary>the trace of a delivery</summary>

```
$ cernanto trace examples/basics/hook
Hook · Next delivery  ok  4.4s  examples_basics_hook:20449:c-0c82c51a-e870-42a9-bbaa-73826ef797bc
2026-10-02 21:17:15

21:17:15  ← Gateway
            Next delivery

21:17:15  → Webhook
            Wait for event
21:17:19  ← Webhook  4.4s  cernanto_webhook:20388:c-0c82c51a-e870-42a9-bbaa-73826ef797bc-1
            Id:          228e796a-746f-4b95-81f9-a2c3be6d0915 163
            Position:    163
            Delivery Id: 228e796a-746f-4b95-81f9-a2c3be6d0915
            Method:      post
            Query:       {}
            Headers:
              Host:           hooks.cernanto.com
              User Agent:     curl/8.7.1
              Accept:         */*
              Content Type:   application/json
              Content Length: 49
            Raw Body:    eyJldmVudCI6ImJhY2t1cC5mYWlsZWQiLCJqb2IiOiJuaWdodGx5IiwiaWQiOjQyfQ==
            Body:
              Event: backup.failed
              Job:   nightly
              Id:    42

21:17:19  → Webhook
            Ack event
            Event Id:     (same as above)
            Status:       200
            Content Type: text/plain
            Body:         backup.failed
21:17:19  ← Webhook  7ms  cernanto_webhook:20388:c-0c82c51a-e870-42a9-bbaa-73826ef797bc-2
            Done

21:17:19  → Gateway  4.4s
            backup.failed
```

</details>

A delivery posted while nobody waits is kept thirty seconds for the
next wait, and the provider's request waits with it: the post below
hangs until the other terminal asks for the next delivery, which
answers both. After thirty seconds with no wait the provider is told
to retry instead, and the delivery is dropped: the queue is the
process's memory, and the provider's retry is the durability.

```
$ curl -s -X POST -H 'content-type: application/json' -d '{"event":"disk.full"}' "$URL"
                                                        # parks until the other terminal asks for the delivery
$ cernanto call examples/basics/hook nextDelivery
"disk.full"
$                                                       # the first terminal answers:
disk.full
```

**Change one sentence.** Say "no event" instead of "unknown":

<!-- lab edit examples/basics/hook.cern.md
"unknown" when the body has none
=>
"no event" when the body has none
-->

```
$ cernanto deploy examples/basics/hook
$ cernanto call examples/basics/hook nextDelivery
                                                        # parks until a delivery arrives
$ curl -s -X POST -H 'content-type: application/json' -d '{"id":44}' "$URL"
no event
$                                                       # the first terminal answers:
"no event"
```

The url did not change: the agent's id is the same, so its road on the
relay is the same.

## notice, a mock for the public board: announce an incident

```
Given an incident's title and its severity, announce the incident
with connectors/ntfy on the team's public board, the topic
`cernanto-examples-incidents`,
when the severity is high, and answer whether it was announced.

Uses:

- connectors/ntfy

## Tests

Mocks:

- connectors/ntfy

In the tests, replace connectors/ntfy with a mock, so nothing is posted on the public board.
Prove a high severity is announced once, with the incident's title, and a low one never.
```

The second half of the alert road: what the hook took in, the notice
announces. The spec grants the connector it announces with and, under
`## Tests`, names it among the mocks and says what to prove; the
compile prints the labels back before it writes anything:

```
examples/basics/notice  plan  reads Uses: connectors/ntfy
examples/basics/notice  plan  reads the tests; Mocks: connectors/ntfy
```

The board is public (`connectors/ntfy` posts to ntfy.sh, where anyone
who knows a topic reads it), so a verify must never post there. Every
other agent in this folder is verified against its real dependencies;
this one says its tests replace the single dependency that must not
act, and the compile writes a mock of it from the ntfy
contract, in the same session as the tests, linked into the copy of
the agent under test in place of the real connector. The agent's code
does not change: it calls `publish` as it always does and keeps what
comes back. The mock is the tests' own code, kept in the package at
`tests/mocks/connectors-ntfy.ts`; it answers from what each call
brings and keeps no memory, so a post to the wrong topic, a post
without the incident's title, or a post the test marked as forbidden
is refused from the content alone:

```ts
export async function publish(args: PublishArgs): Promise<Published> {
  const text = `${args.title}\n${args.message}`;
  if (text.includes(NEVER_MARK)) {
    throw new Error(`mock ntfy: an incident marked ${NEVER_MARK} was published`);
  }
  if (args.topic !== BOARD) {
    throw new Error(`mock ntfy: published to topic "${args.topic}", expected "${BOARD}"`);
  }
  const mark = INCIDENT_MARK.exec(text);
  if (!mark) {
    throw new Error(`mock ntfy: the announcement carries no incident title`);
  }
  return { id: `mock-${mark[0]}`, time: new Date() };
}
```

The deploy log prints the verify as a conversation, the mocked call
marked `(mock)`:

<details>
<summary>the copy's trace, as the deploy of examples/basics/notice printed it</summary>

```
Notice Under Test Bld 0f96e57862453f18 R1 · Notice  ok  2ms  examples_basics_notice_under_test_bld_0f96e57862453f18_r1:20287:c-c4b438d0-8cf1-420f-bd29-3a2199848514
2026-09-27 15:02:44  from Notice Tester Bld 0f96e57862453f18 R1  examples_basics_notice_tester_bld_0f96e57862453f18_r1:20288:c-2644e71a-102d-4ed7-8392-22c25e3f4677

15:02:44  ← Notice Tester Bld 0f96e57862453f18 R1
            Notice
            Title:    INC-057af859 Database down
            Severity: high

15:02:44  → Ntfy
            Publish
            Topic:   cernanto-examples-incidents
            Title:   INC-057af859 Database down
            Message: Incident: INC-057af859 Database down (severity: high)
15:02:44  ← Ntfy (mock)  1ms  examples_basics_notice_under_test_bld_0f96e57862453f18_r1:20287:c-c4b438d0-8cf1-420f-bd29-3a2199848514~1
            Id:   mock-INC-057af859
            Time: 2026-09-27T15:02:44.660Z

15:02:44  announced incident "INC-057af859 Database down" on cernanto-examples-incidents as mock-INC-057af859

15:02:44  → Notice Tester Bld 0f96e57862453f18 R1  2ms
            true
```

</details>

The deployed agent has no mock: a real call reaches the real board.

```
$ cernanto call examples/basics/notice notice --args '{"title":"Nightly backup failed","severity":"high"}'
true
$ cernanto call examples/basics/notice notice --args '{"title":"Typo on the help page","severity":"low"}'
false
$ curl -s 'https://ntfy.sh/cernanto-examples-incidents/json?poll=1&since=all' | tail -n 1
{"id":"X41KAXJjvPlz","time":1790603192,"expires":1790646392,"event":"message","topic":"cernanto-examples-incidents","title":"Nightly backup failed","message":"Incident: Nightly backup failed (severity: high)"}
```

<details>
<summary>the trace of the real call</summary>

```
$ cernanto trace examples/basics/notice
Notice · Notice  ok  4.3s  examples_basics_notice:20289:c-1193cf92-84e0-48f7-acf2-06a7172ccca1
2026-09-27 15:03:26

15:03:26  ← Gateway
            Notice
            Title:    Nightly backup failed
            Severity: high

15:03:26  → Ntfy
            Publish
            Topic:   cernanto-examples-incidents
            Title:   Nightly backup failed
            Message: Incident: Nightly backup failed (severity: high)
15:03:31  ← Ntfy  4.3s  connectors_ntfy:20286:c-1193cf92-84e0-48f7-acf2-06a7172ccca1-1
            Id:   53DcXkqhNdFC
            Time: 2026-09-27T15:03:31.000Z

15:03:31  announced incident "Nightly backup failed" on cernanto-examples-incidents as 53DcXkqhNdFC

15:03:31  → Gateway  4.3s
            true
```

</details>

The four seconds are the connector's process booting: a task parks
to zero between calls, and the first call after its deploy waits for
it. The verify's call, a millisecond, never left the copy's process.

**Change one sentence.** Announce medium incidents too:

<!-- lab edit examples/basics/notice.cern.md
when the severity is high, and answer whether it was announced.
=>
when the severity is high or medium, and answer whether it was announced.
-->

```
$ cernanto deploy examples/basics/notice
$ cernanto call examples/basics/notice notice --args '{"title":"Disk almost full on the backup host","severity":"medium"}'
true
```

What the spec says of its tests still holds (a high one announced
once, a low one never), so the deployed tests are kept, and the compile
adds one for the medium severity the agent now promises.

## clock, a worker: a program on its own schedule

```
Runs by itself from the moment it is deployed; nothing calls it.
Five seconds after it starts, and every five seconds after that,
announce the time. After thirty seconds, finish.

Type: worker
```

A worker is a program the plane starts and stops with its generation;
nobody calls it, and its code keeps its own time. It has no tests: the
deploy starts it, and its trace is the proof. This one is the tiniest
reference; a worker that reports the unresolved requests every morning
is the same shape with a report in place of the announcement.

```
$ cernanto deploy examples/basics/clock
landed 1 package; nothing to compile
deployed examples/basics/clock
examples/basics/clock is unchanged; running its program again
follow examples/basics/clock live: cernanto trace examples/basics/clock -f
$ cernanto trace examples/basics/clock
Clock · Run  ok  30.0s  examples_basics_clock:20142:k-worker=003aexamples=002fbasics=002fclock=003ap20142:run
2026-09-27 10:10:48

10:10:48  ← Run

10:10:48  The time is 2026-09-27T10:10:48.072Z
10:10:53  · slept 5.0s
10:10:53  The time is 2026-09-27T10:10:53.075Z
10:10:58  · slept 5.0s
10:10:58  The time is 2026-09-27T10:10:58.076Z
10:11:03  · slept 5.0s
10:11:03  The time is 2026-09-27T10:11:03.077Z
10:11:08  · slept 5.0s
10:11:08  The time is 2026-09-27T10:11:08.082Z
10:11:13  · slept 5.0s
10:11:13  The time is 2026-09-27T10:11:13.085Z
10:11:18  · slept 5.0s

10:11:18  → reply  30.0s
            Done
```

**Change one sentence.** Every ten seconds instead of five; the deploy
starts the new version, and its trace has three announcements:

<!-- lab edit examples/basics/clock.cern.md
Five seconds after it starts, and every five seconds after that,
=>
Ten seconds after it starts, and every ten seconds after that,
-->

```
$ cernanto deploy examples/basics/clock
$ sleep 45; cernanto trace examples/basics/clock
Clock · Run  ok  30.0s  examples_basics_clock:20401:k-worker=003aexamples=002fbasics=002fclock=003ap20401:run
2026-09-28 11:40:02

11:40:02  ← Run

11:40:12  · slept 10.0s
11:40:12  The time is 2026-09-28T11:40:12.071Z
11:40:22  · slept 10.0s
11:40:22  The time is 2026-09-28T11:40:22.074Z
11:40:32  · slept 10.0s
11:40:32  The time is 2026-09-28T11:40:32.077Z

11:40:32  → reply  30.0s
            Done
```

## greeting, formal, usher, welcome: an interface and its implementors

```
greeting.cern.md    Type: interface
                    This page only defines the contract every greeter
                    implements: given a name, answer a greeting for
                    that person.

formal.cern.md      Type: module
                    Implements: examples/basics/greeting
                    One of the examples/basics/greeting greeters, a library
                    linked into the agents that use it.
                    Greet formally: "Good day, <name>."

usher.cern.md       Uses: examples/basics/formal, examples/basics/counter
                    Implements: examples/basics/greeting
                    One of the examples/basics/greeting greeters. Greet the
                    visitor formally, with examples/basics/formal, and tell
                    them their queue number, the next one that
                    examples/basics/counter hands out: "Good day, Ada. You are
                    number 7." Each visitor gets the next number.

welcome.cern.md     Uses: examples/basics/greeting
                    Given a name and the id of a greeter, greet that
                    person through that examples/basics/greeting greeter and
                    answer its greeting. Its tests use examples/basics/usher.
```

One job, several providers, and each spec declares its part: greeting
is the interface, formal and usher implement it, welcome grants it
and greets through whichever greeter it is given, and the compile
prints the labels back:

```
examples/basics/formal   plan  reads Implements: examples/basics/greeting
examples/basics/usher    plan  reads Uses: examples/basics/formal, examples/basics/counter
examples/basics/usher    plan  reads Implements: examples/basics/greeting
examples/basics/welcome  plan  reads Uses: examples/basics/greeting
examples/basics/welcome  plan  reads the tests; Uses: examples/basics/usher
```

An interface is a contract nothing runs.
Formal implements it as a module, code linked into whoever uses it,
because a greeting line has no life of its own. Usher implements it as
a task, because it calls other agents: it links formal in and asks the
counter over the wire. Welcome uses the interface and never names an
implementor; the greeter's id arrives as an argument, and the runtime
binds it when the call is made: a module implementor answers inside
welcome's own process, any other over the wire. The same mechanics
carry the desks in `examples/workflows/`: `connectors/chat` is an interface,
`examples/sandbox/chat` one implementor, and the config key `connectors/chat/default`
names the one a desk talks to.

Deploy the top of the chain and the rest comes with it:

```
$ cernanto deploy examples/basics/usher
landed 3 packages; nothing to compile
$ cernanto call examples/basics/usher greet name=Ada
{"greeting":"Good day, Ada. You are number 101."}
```

The trace of a call shows both roads at once: formal answers in
process, the counter over the wire.

```
$ cernanto trace examples/basics/usher
Usher · Greet  ok  8ms  examples_basics_usher:20296:c-56f0ef0b-7685-4ac7-b9b9-ad34bcce3a74
2026-09-27 17:30:48

17:30:48  ← Gateway
            Greet
            Name: Grace

17:30:48  → Formal
            Greet
            Name: Grace
17:30:48  ← Formal  1ms  examples_basics_usher:20296:c-56f0ef0b-7685-4ac7-b9b9-ad34bcce3a74~1
            Greeting: Good day, Grace.

17:30:48  → Counter
            Next
            Done
17:30:48  ← Counter  4ms  examples_basics_counter:20292:c-56f0ef0b-7685-4ac7-b9b9-ad34bcce3a74-1
            22

17:30:48  → Gateway  8ms
            Greeting: Good day, Grace. You are number 22.
```

Then welcome, which chooses by the argument:

```
$ cernanto deploy examples/basics/welcome
$ cernanto call examples/basics/welcome welcome name=Ada greeterId=examples/basics/formal
"Good day, Ada."
$ cernanto call examples/basics/welcome welcome name=Ada greeterId=examples/basics/usher
"Good day, Ada. You are number 102."
```

Welcome's spec goes on with one sentence on how to test it: greet a
person through the usher, a greeter that runs as an agent of its own,
and through formal, one linked into welcome itself. The compile finds
the implementors of an interface an agent uses, deployed or in the
workspace, and names them to the tester, so welcome's two tests go
through formal and through usher.

**Change one sentence.** Change formal's greeting line and deploy
welcome again. Formal is stale and recompiles; usher and welcome are not,
because a module's wording change keeps its contract, and they pick the
new formal up when their processes next start:

<!-- lab edit examples/basics/formal.cern.md
Greet formally: "Good day, <name>."
=>
Greet formally: "Good day, dear <name>."
-->

```
$ cernanto deploy examples/basics/welcome
$ cernanto call examples/basics/welcome welcome name=Ada greeterId=examples/basics/formal
"Good day, dear Ada."
```

## shortlist, two decisions over a list: the articles that answer a question

```
Given a customer's question and the articles of a help centre, each a
title and a text, answer the articles that answer the question, best
first and at most three, and the one article the answer should come
from. When no article answers it, answer an empty shortlist and no
article. Choose them with cernanto/decision.

Uses:

- cernanto/decision
- cernanto/config
```

Two decisions over the same list, and no judgment of the text itself:
the code asks the decision engine which articles pass ("the article
answers the question"), the ones that pass come back best first, and
the best of them is the one the answer should come from. Nothing is
written: the agent answers the caller's own articles, chosen.

```
$ cernanto call examples/basics/shortlist shortlist --args '{"question":"How do I reset my password?","articles":[{"title":"Resetting your password from the sign-in page","text":"Click Forgot password under the sign-in form and follow the mail."},{"title":"Changing your billing address","text":"Open Billing, then Address, and save."},{"title":"Password reset by email link, step by step","text":"We mail a link that opens a page where you type a new password twice."},{"title":"Shipping times by region","text":"Two days in the EU, five elsewhere."}]}'
{"shortlist":[{"title":"Resetting your password from the sign-in page","text":"Click Forgot password under the sign-in form and follow the mail."},{"title":"Password reset by email link, step by step","text":"We mail a link that opens a page where you type a new password twice."}],"article":{"title":"Resetting your password from the sign-in page","text":"Click Forgot password under the sign-in form and follow the mail."}}
```

Point the plane at a decision model, with its key stored as the root
README shows (`cernanto config cernanto/decision/jev token=<key>`, then
`cernanto config cernanto/decision default=cernanto/decision/jev`), and the same
call answers in well under a second, the probability of each article
beside the answer in its trace. The setting is the plane's, so this
walkthrough leaves it alone.

## severity, a degree on a scale: rate an incident and page

```
Given an incident report, place it on the scale cosmetic,
inconvenient, blocking, data loss, from least to most, and answer the
level and whether to page the on-call engineer: page at blocking or
worse. Given also how many customers the report says are affected,
answer a priority from zero to one that weighs the severity at sixty
percent and the reach at forty percent, the reach placed on the scale
one, some, most, all. Decide with cernanto/decision; the weighing is
arithmetic on the levels' places. A report that does not say how many
customers are affected counts as one.

Uses:

- cernanto/decision
- cernanto/config
```

A level is one of the words the spec lists, in their order, so the
threshold is a comparison of places and the priority is arithmetic the
code does on two levels. The engine is never asked for a number.

The compile read the two answers as one function, the reach taken from
the report itself:

```
$ cernanto call examples/basics/severity assessIncident report="The export button does nothing when clicked, so customers cannot download their invoices. Most customers are affected."
{"severity":"blocking","page":true,"reach":"most","priority":0.6666666666666666}
$ cernanto call examples/basics/severity assessIncident report="The settings page heading has a typo, seen by one customer so far."
{"severity":"cosmetic","page":false,"reach":"one","priority":0}
```

## What every one of these shares

- The spec says what the agent does, in sentences a colleague could
  follow, and never how the code does it. The compile reads the contracts
  of whatever the spec grants.
- The tests are written by the compile from the spec and run live against
  a temporary copy of the agent before it lands. `cernanto tests
examples/basics/<agent>` shows them, and `cernanto code examples/basics/<agent>` the code.
- Everything an agent does is in its trace, read as a conversation:
  what came in, what it called, what came back, what it answered.
- One sentence changed is one deploy: an amend of the previous compile,
  proved live before it lands, and `cernanto contract` shows what
  the change added.

## orders, an API of its own: serve an OpenAPI document

```
Keep the orders placed between calls, each under the id this agent
hands back, `o-1` for the first, `o-2` for the second, and so on.
Serve the API that orders/openapi.yaml describes over http on port
8080. Reading an unknown id is the document's not-found answer with
the id as the problem's detail.

Type: service

Implements:

- openapi:orders/openapi.yaml
```

When the API is already fixed, the document is the contract:
`examples/basics/orders/openapi.yaml` declares two operations, and the spec
names the document on its `Implements:` line and says where the agent
listens. The compile
generates the server, the typed empty functions the coder fills and
the handler that turns each request into a call, and the agent
listens for itself on the port the sentence names, with the
document's paths exactly as written. It keeps the orders between
calls, so it is a service, and an agent that listens keeps one copy
up.

```
$ cernanto deploy examples/basics/orders
$ curl -s -X POST http://127.0.0.1:8080/orders -H 'content-type: application/json' -d '{"total": 12, "lines": ["a"]}'
{"id":"o-1","total":12,"lines":["a"]}
$ curl -s http://127.0.0.1:8080/orders/o-1
{"id":"o-1","total":12,"lines":["a"]}
$ curl -s http://127.0.0.1:8080/orders/o-9
{"detail":"o-9"}
```

The third answer is the document's declared 404 with the id as the
problem's detail, thrown by the function as a declared error and
answered as the document says. A request the document refuses, a body
without its `total`, is answered 400 before any call is made:

```
$ curl -s -X POST http://127.0.0.1:8080/orders -H 'content-type: application/json' -d '{"lines": ["a"]}'
{"error":{"kind":"contract-violation","message":"/requestBody must have required property 'total'"}}
```
