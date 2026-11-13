# Jira

Uses: mcp:https://mcp.atlassian.com/v1/mcp/authv2

Jira in the Atlassian site the operator signs into through Atlassian's
own MCP server; a named account is a second user or site connected
under that name. Answer the open tickets of a project by its key, each
with its key, summary, status and assignee, newest first; a ticket by
its key, with its summary, description, status, assignee and comments;
and create a ticket in a project with a summary and a description,
answering its key. Add a comment to a ticket and answer its id. Wait
for the next ticket created in a project, or for the next comment on a
ticket by someone other than the account, after the call began or
after the ticket or comment named as the position, and answer it, or
null when the timeout passes, five minutes when none is given.

## Tests

Uses: cernanto/config

The project is the one the tests read from the configuration under
`project`; the second user, who creates and comments on the
tickets the tests wait for, is the account connected under the name
`tester`. The tickets the tests create name the test in their summary
and stay in the project.

## License

Copyright: 2026 Cernanto

License: Apache-2.0
