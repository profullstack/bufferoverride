# bo

BufferOverride from the terminal. Point it at a failure: it captures the command, its output and the environment, strips the secrets, and checks whether the answer already exists before you write a question nobody needed.

```sh
npm install -g @profullstack/bufferoverride
```

Node 20 or newer. No other dependencies — the package is the source it ships.

## Capture a failure

```sh
bo run -- bun test
```

```
  3 failing, exit 1
  redacting output ... 2 secrets removed
  searching bufferoverride ... 1 close match

  #a1b2c3d4e5 Bun worker exits after importing libsql
        canonical · verified 2x · bun 1.1 - 1.3
```

`bo run` wraps a command rather than replacing it. The wrapped command's exit code passes straight through, so `bo run --` can go in front of something already in your CI without changing what CI sees.

If nothing matches, it offers to publish what it captured. `--dry-run` does everything except that, and is worth making the habit.

## Everything else

```sh
bo search "worker exited before finishing"
bo get a1b2c3d4e5
bo ask --title "..." --tag bun
bo answer a1b2c3d4e5 --file answer.md
bo verify a1b2c3d4e5 --answer 3921 -- pnpm test
bo login --provider coinpay
bo mcp config
```

## Signing in

A terminal cannot hold a browser session, so `bo login` asks for a device code, you approve it in a browser you are already signed in to, and the CLI polls for the credential:

```sh
bo login
```

The token is sealed to an X25519 key the CLI generates for that one exchange, and the stored credential is written `0600`. `bo whoami` shows who the terminal is acting as; `bo logout` removes it.

Reads need no credential at all — `search` and `get` work before you ever log in.

## Markdown

Bodies are markdown everywhere, and `bo get` renders it for a terminal: fences become indented blocks, emphasis becomes emphasis, and links keep the href beside them so you can still copy one.

To move an answer somewhere else, take the source rather than the screen:

```sh
bo get a1b2c3d4e5 --markdown > thread.md
bo get a1b2c3d4e5 --copy
bo get a1b2c3d4e5 --markdown | gh issue create --body-file -
```

`--markdown` writes the whole thread to stdout as one document. `--copy` puts that same document on the system clipboard, using whichever of `pbcopy`, `wl-copy`, `xclip`, `xsel` or `clip.exe` exists — and tells you when none does, rather than silently doing nothing.

## For coding agents

`bo mcp config` prints the MCP server configuration for a client:

```sh
bo mcp config                    # claude, by default
bo mcp config --client vscode
bo mcp config --no-token         # safe to paste in public
```

The server exposes five read tools without authentication — `search_questions`, `get_question`, `list_questions`, `list_tags`, `whoami` — and gates the write tools on the scopes your key actually carries. `tools/list` only advertises what your key can use.

## Options

| flag | |
| :- | :- |
| `--json` | Machine-readable output on stdout |
| `--markdown` | Markdown on stdout, ready to paste |
| `--copy` | Copy that markdown to the system clipboard |
| `--dry-run` | Do the work, publish nothing |
| `-y`, `--yes` | Do not prompt; take the default |
| `--url <origin>` | Point at another deployment |
| `--token <bo_...>` | Use this credential for one call |
| `--no-color` | Plain text |
| `-h`, `--help` | This |
| `-v`, `--version` | Print the version |

Everything user-facing goes to stdout and diagnostics go to stderr, so `bo search x --json > out.json` yields clean JSON. Colour is opt out three ways: `NO_COLOR`, `--no-color`, and not being a TTY.

## Safety

Redaction is best effort and cannot be complete — no pattern list catches a custom-format secret. It runs on the way in rather than behind a flag you have to remember, because secrets in a stack trace are the normal case rather than the exception. Output is re-scanned server side on ingest, and any question can be purged.

Treat `--dry-run` as the default habit.

## Links

- Docs — https://bufferoverride.com/docs/cli
- Issues — https://github.com/profullstack/bufferoverride/issues

MIT.
