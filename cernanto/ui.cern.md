# cernanto/ui

Type: module

Uses: file:ui/bundle/

The plane's web UI, answered file by file: the page's document, a
script by its name and a stylesheet by its name, each as its text.
The files are the UI whole, a web page made to run in a browser, and
each is answered as it lies.

## The files

The document is the file `index.html`. The scripts are the files of
the folder `js` and the stylesheets the files of the folder `css`,
each a file of its folder itself. `document` answers the document's
text. `script` takes a name and answers the text of the script of
that name, and `stylesheet` takes a name and answers the text of the
stylesheet of that name. A name is answered when its folder's own
listing holds it, the listing read at the call; for every other name
the answer is null. Each text is read as UTF-8 at the call.

## Tests

`document` answers a text that begins with `<!doctype html>`, in any
case of its letters. The document names the files it loads: the name
after `/ui/js/` in the address of a script it loads is answered by
`script` with a text of one character or more, and the name after
`/ui/css/` in the address of its stylesheet the same by `stylesheet`.
`script` and `stylesheet` answer null for `none.js` and for
`../index.html`.

## License

Copyright: 2026 Cernanto. All rights reserved.

License: BUSL-1.1
