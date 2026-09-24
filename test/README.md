# Tests

```bash
npm test
```

No test framework, no dependencies — Node's own built-in runner, the same way
the rest of the vault avoids anything it would have to download. Every test
runs offline and finishes in a couple of seconds.

| File | What it protects |
|---|---|
| `server.test.js` | the security guards: the CSRF header, the cross-site check, the Host allow-list, the download host and filename rules, prototype pollution, and that a malformed request cannot kill the process |
| `content.test.js` | the content itself: frontmatter every lesson needs, no clashing orders, exercises that have answers, well-formed `wiki:` links, escaped pipes in tables, a valid pack catalogue, no duplicate flashcards |
| `store.test.js` | that nothing is lost: the write-then-rename, a corrupt file quarantined rather than overwritten, `await save()` meaning what it says |
| `packs.test.js` | the download queue: what is enqueued, what is skipped, moving a pack to the front, and the lock that stops two Vaults fighting over one file |
| `srs.test.js` | the flashcard scheduler: a failed card comes back in minutes, a learned one in days, and intervals grow but stay inside a lifetime |
| `markdown.test.js` | the renderer that writes every page: HTML escaped, tables intact, `wiki:` links marked |
| `sheets.test.js` | CSV in and out, including neutralising text another spreadsheet would run as a formula |

The server tests start a real `ArkServer` on an ephemeral port with its own
empty data directory, so they never touch your library or your settings.

## When something fails

A failing test in `content.test.js` usually means a lesson is malformed and
would have vanished from the School page without any error. The message names
the file and the missing piece.

A failing test in `server.test.js` means a security guard has been weakened.
Do not relax the test to make it pass; the comment at the top of each block
says which review finding it came from.
