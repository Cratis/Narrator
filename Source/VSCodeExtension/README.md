# Narrator - Chronicle Explorer

A VS Code extension that integrates with [Cratis Chronicle](https://github.com/Cratis/Chronicle) to browse and explore event stores directly from VS Code.

## Features

- **Browse event stores**: Navigate event stores, namespaces, and observers in a dedicated sidebar panel.
- **Context switching**: Switch between multiple Chronicle server contexts defined in `~/.cratis/config.json`.
- **Auto-connect**: Automatically connects to the active context on startup.
- **Config file watching**: Reloads configuration automatically when `~/.cratis/config.json` changes.

## Configuration

The extension reads connection settings from the same CLI config file used by the Cratis CLI:

**`~/.cratis/config.json`**
```json
{
  "activeContext": "default",
  "contexts": {
    "default": {
      "server": "chronicle://localhost:35000",
      "managementPort": 8080
    }
  }
}
```

You can also override the config path in VS Code settings:

```json
{
  "narrator.configPath": "/path/to/custom/config.json"
}
```

## Commands

| Command | Description |
|---------|-------------|
| `Narrator: Refresh` | Reload the Chronicle Explorer tree |
| `Narrator: Connect to Chronicle` | Connect (prompts for server URL if not configured) |
| `Narrator: Set Active Context` | Switch between configured Chronicle contexts |
| `Narrator: Open Narrator Settings` | Open VS Code settings for the extension |

## Build

```bash
cd Source/VSCodeExtension
yarn install --immutable
yarn compile
```

To package:
```bash
yarn vscode:prepublish
yarn exec vsce package
```
