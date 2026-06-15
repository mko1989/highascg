Drop server updates here (contents of highascg-server_*.tar.gz from GitHub releases).

Required: package.json at the top of this folder (along with index.js, src/, tools/runtime/, …).

On boot the live system will:
  - stop highascg.service
  - rsync this folder → /home/casparcg/highascg (client/ and dist-web/ are not touched)
  - run npm ci when package-lock.json is included
  - move this folder to drop-update/applied/<timestamp>/
  - start highascg.service

UI/simulation runs from the Electron launcher on Mac/Windows — not from this stick path.
