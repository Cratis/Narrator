# Narrator

Narrator is a VS Code extension for exploring Cratis Chronicle event stores.

## Run locally

1. Open the repository in VS Code.
2. Install dependencies and compile the extension:

   ```bash
   cd /home/runner/work/Narrator/Narrator/Source/VSCodeExtension
   npm ci
   npm run compile
   ```

3. Create or update your Chronicle CLI config at `~/.cratis/config.json`:

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

4. In VS Code, open `/home/runner/work/Narrator/Narrator/Source/VSCodeExtension`.
5. Press `F5` to launch an **Extension Development Host** window.
6. In the development host, open the **Narrator** view in the activity bar and connect to your local Chronicle instance.

For iterative development, run this in a separate terminal from `/home/runner/work/Narrator/Narrator/Source/VSCodeExtension`:

```bash
npm run watch
```

## Get changes into `main`

Do not push directly to `main`. Use a branch and a pull request:

```bash
cd /home/runner/work/Narrator/Narrator
git checkout -b <your-branch-name>
git add .
git commit -m "Describe your change"
git push -u origin <your-branch-name>
```

Then open a pull request targeting `main` and merge it after review and checks pass.
