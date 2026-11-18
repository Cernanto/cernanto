# Jira

`connectors/jira` reads and writes Jira tickets through Atlassian's own
MCP server: the open tickets of a project, a ticket with its comments,
a new ticket, a comment, and a wait for the next ticket in a project
or the next comment on a ticket. It is the tree's signed-in MCP grant:
the spec names the server's url and nothing else, the tools are read
at the compile, and the account is the server's own sign-in.

## Connect

The sign-in happens in the browser. The first compile asks for it, since
the compiler lists the server's tools on the connector's behalf, and so
does the first call after a logout; a deploy or an invoke in a terminal
shows the ask inline, and from anywhere else:

```
$ cernanto auth login connectors/jira mcp.atlassian.com
```

opens the authorization page: sign in to Atlassian, pick the site, and
allow the access; the run resumes by itself.

A named account is a second user or site, logged in the same way
under that name: the support follow-up's real form plays its customer
as `tester`. Sign in as the second user in a fresh browser profile, so
the site does not hand back the first one's session:

```
$ cernanto auth login connectors/jira tester
```

## Verify it

The connector's own tests need a Jira project and one account, the
default: the project's key in the configuration, and no second user.

```
$ cernanto config connectors/jira/tests project=SUP
$ cernanto deploy connectors/jira
```

The deploy runs the tests live as that one account: it creates a
ticket, reads it, comments on it and finds it among the open ones; a
wait started before it creates another answers that ticket; and a wait
for a comment answers nothing to the account's own comment. The
tickets the tests create name the test in their summary and stay in
the project. A comment by someone else, which one account cannot
make, is played where a desk uses the connector with a second user,
as the support follow-up's real form does.

## Use it

`cernanto contract connectors/jira` prints the functions the compile
wrote and what each takes; the support follow-up's real form grants it
in place of the sandbox CRM, as `examples/workflows/support-follow-up/README.md`
shows.
