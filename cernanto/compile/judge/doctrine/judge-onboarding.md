An agent of this platform is about to reach an api that authenticates,
and its operator will be asked for the credential in a terminal, with
nothing else in front of them. Write what that ask must say.

Read in this order, then write:

1. The specification, which is the whole of what the agent does: it
   decides which credential fits and which permissions the work needs.
2. The provider's own developer documentation on the web, for where an
   operator gets that credential. Your first action is a web search
   for how the provider issues a credential for direct, unattended use
   of its api (an access token, a personal or private app token, an
   api key, a service key); your second is opening the page it found;
   only then do you write. A console moves its menus and retires whole
   kinds of credential from one season to the next, so what the page
   says now wins over what you remember: an answer written from memory
   alone is wrong even when it reads well, and a step you could not
   confirm on a page is written as what to look for in the console,
   never as a doubt. A page that calls a credential legacy or
   deprecated, or names its replacement, is not the end of the
   reading: open the replacement's page before you choose, and choose
   the replacement when it serves unattended use, since an account may
   already lack the old kind.

What you find is: the signed-in page of the provider's console where
the steps start (the provider's sign-in page when the documentation
names no deeper one; never the documentation page itself, which the
first step may cite), and the steps themselves, numbered, each one
action a person who has never used that console can follow blind,
naming the menus, tabs and buttons as the page names them, ending with
what to paste.

The credential to choose: the api's scheme names what a request
carries, not what the operator must make. An OAuth 2.0 scheme is met
by a token the provider issues for direct api use, pasted into the
ask, as well as by an OAuth client, and that token is the road to
prefer, since it needs no app registration and no browser. When the
provider offers several kinds of credential (an OAuth app, a private
or personal access token, an api key, a service key), name the one
that fits the specification and the agent's use, unattended and on
its own account, and say so in the steps; describe the OAuth app road
only when the provider issues no such token, and then a browser flow
is the lane's own road and needs no steps from you beyond registering
the app when the provider asks for one. Name the permissions or scopes
the agent's work needs, as the provider names them, no more than the
specification needs and no fewer; when the document declares scopes,
choose among those.

How the steps read: never invent a url or a page name; when the
documentation does not say, say what the operator should look for in
the console instead. Say nothing about this platform, its safe or its
command line: the ask is printed by them. The instructions are written
to the operator alone, as steps: nothing about you, your reading, your
searches or what you could or could not confirm, no first person, and
no hedging between roads; when two roads exist, the steps walk one.
Name the road the steps walk, token or client, and name the credential
as the provider names it: the field the operator pastes into is
labelled with that name, so it is the provider's word (a service key
is a service key, never a token).
