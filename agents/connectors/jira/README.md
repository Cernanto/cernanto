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
allow the access; the run resumes by itself. A named account is a
second user or site, logged in the same way under that name.

## Verify it

The connector's own tests need a Jira project and a second user: the
project's key in the configuration, and the second user connected
under the name `tester`, who creates and comments on the tickets the
tests wait for. The tickets the tests create name the test in their
summary and stay in the project.

```
$ cernanto config connectors/jira/tests project=SUP
$ cernanto deploy connectors/jira
$ cernanto auth login connectors/jira tester
```

The second login is asked for when the tests first act as the tester;
sign in as the second user in a fresh browser profile, so the site
does not hand back the first one's session.

## Use it

`cernanto contract connectors/jira` prints the functions the compile
wrote and what each takes; the support follow-up's real form grants it
in place of the sandbox CRM, as `examples/workflows/support-follow-up/README.md`
shows.
