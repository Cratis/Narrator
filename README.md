<div align="center">

# 🎙️ Narrator

**Reads your Cratis Chronicle event stores back to you — browse the streams, namespaces, and observers and follow the story your events tell, right inside VS Code.**

[![Discord](https://img.shields.io/discord/1182595891576717413?label=Discord&logo=discord&logoColor=white)](https://discord.gg/kt4AMpV8WV)
[![VS Code Marketplace](https://img.shields.io/visual-studio-marketplace/v/cratis.narrator?label=VS%20Code%20Marketplace&logo=visualstudiocode&logoColor=white)](https://marketplace.visualstudio.com/items?itemName=cratis.narrator)
[![Build](https://github.com/Cratis/Narrator/actions/workflows/javascript-build.yml/badge.svg)](https://github.com/Cratis/Narrator/actions/workflows/javascript-build.yml)
[![Publish](https://github.com/Cratis/Narrator/actions/workflows/publish.yml/badge.svg)](https://github.com/Cratis/Narrator/actions/workflows/publish.yml)

</div>

---

Every story needs someone to tell it. **Chronicle** records what happened as an immutable log of events — the
raw facts, in order, forever. Narrator is the voice that reads that log back: it connects to a running
Chronicle instance and walks you through its event stores, namespaces, and observers in a dedicated VS Code
panel, so you can open any event type's schema or follow it straight to where it's declared. The events are the
story; Narrator recounts them, without ever leaving your editor.

## 🎙️ Why "Narrator"?

Three reasons, and they all line up:

- **A narrator recounts the sequence of events.** That's precisely what an event store *is* — an ordered
  sequence of facts about what happened. Narrator gives that sequence a voice you can browse.
- **It tells the story where you write it.** Narrator lives in VS Code, right next to the code that appends
  those events, so reading the log and reading the source are one motion.
- **The Cratis storytelling family.** Cratis names its products after telling a story: **Chronicle** records
  the events, **Arc** shapes the plot, **Screenplay** is the script, **Stage** performs it, **Lens** frames
  it… **Narrator** is the voice that reads the record back. It joins the cast.

## 📖 What it can do

Once connected, the **Narrator** view in the activity bar becomes your window into a Chronicle instance:

- **Browse the cast** — navigate event stores and namespaces down to their event types, read models,
  observers, and projections in a dedicated sidebar tree.
- **Read the events** — open an event sequence and page through the facts it holds — sequence number, event
  type, event source, when it occurred, and the payload.
- **Inspect the schemas** — open the schema for any event type or read model, and open the declaration behind a
  projection.
- **Switch contexts** — move between multiple Chronicle servers defined in `~/.cratis/config.json` without
  reconfiguring anything.
- **Auto-connect & stay in sync** — Narrator connects to the active context on startup and reloads
  automatically when the config file changes.

| Command | What it does |
| --- | --- |
| `Narrator: Refresh` | Reload the Chronicle Explorer tree |
| `Narrator: Connect to Chronicle` | Connect (prompts for a server URL if none is configured) |
| `Narrator: Set Active Context` | Switch between configured Chronicle contexts |
| `Narrator: Add / Edit / Delete Context` | Manage the servers Narrator can read |
| `Narrator: Open Narrator Settings` | Open the extension's VS Code settings |

## ⚙️ Configuration

Narrator reads the same CLI config file the Cratis CLI uses — **`~/.cratis/config.json`**:

```json
{
  "activeContext": "default",
  "contexts": {
    "default": {
      "server": "chronicle://localhost:35000"
    }
  }
}
```

Point it at a different file with the `narrator.configPath` VS Code setting.

## 🚀 Run it locally

From the repository root:

```bash
cd Source/VSCodeExtension
yarn install --immutable
yarn compile
```

Then, in VS Code:

1. Open the `Source/VSCodeExtension` folder.
2. Press **F5** to launch an **Extension Development Host** window.
3. In that window, open the **Narrator** view in the activity bar and connect to your local Chronicle instance.

For iterative development, run the watcher in a second terminal:

```bash
cd Source/VSCodeExtension
yarn watch
```

Package it into a `.vsix`:

```bash
yarn vscode:prepublish
yarn exec vsce package
```

## ✅ Quality gates

```bash
cd Source/VSCodeExtension
yarn typecheck   # zero TypeScript errors
yarn lint        # zero lint errors
yarn test        # all specs green
yarn compile     # the extension bundles clean
```

## 🗺️ Start here

- [`Source/VSCodeExtension/README.md`](Source/VSCodeExtension/README.md) — the extension's own reference.
- [Cratis Chronicle](https://github.com/Cratis/Chronicle) — the event-sourcing engine whose stores Narrator reads.

---

<div align="center">

*Part of the [Cratis](https://cratis.io) platform · MIT licensed*

</div>
