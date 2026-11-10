# Collaboration: 2 humans, 3 lanes, 1 repo

Repo: https://github.com/adarsh-nl/proofpay · Board: https://app.notion.com/p/e1809761315044039838e9ff7bc70f02

## 1. Roles
| | Adarsh | Collaborator |
|---|---|---|
| Primary lanes | Backend lane (backend, PayPal, vision), QA lane (eval) | Frontend lane (UI), QA lane (e2e, demo), Backend lane (T12, T15, S02) |
| Reviews PRs from | Collaborator's lanes | Adarsh's lanes |
| Decides | vision thresholds, demo story, final submit. Sponsor targets are **both** Render and AG Grid | UI/UX, copy, e2e scope |
| Devpost | **Team Representative**: creates the project, invites the Collaborator, submits | Drafts text, uploads screenshots |

## 2. Branches
- `main` is always deployable. It's protected: PR required, CI must pass, no force‑push (Adarsh sets this up in GitHub → Settings → Branches during T00).
- Work branches: `feat/<TaskID>-<slug>`, `fix/<TaskID|B##>-<slug>`, `docs/<id>-<slug>`.
- One task per branch per PR. Branches live < 4 hours. If a task is bigger, split it in Notion (`T07a`, `T07b`).
- Parallel agents on one machine use **git worktrees** so they never share a working directory:
  ```bash
  git worktree add ../proofpay-T05 -b feat/T05-payments-ops origin/main
  git worktree add ../proofpay-A01 -b feat/A01-eval-dataset origin/main
  # when merged:
  git worktree remove ../proofpay-T05
  ```

## 3. PR flow
1. The agent opens the PR using the template; the human driving it checks the hand‑off block.
2. **Review SLA: 20 minutes** during work blocks. The reviewer runs `gh pr checkout <n> && npm run check`, plus a quick manual smoke for UI.
3. Squash‑merge. Delete the branch. Notion → Done.
4. Everyone else rebases their open branches: `git fetch origin && git rebase origin/main`.
5. A PR touching `src/shared/**` gets the `contract-change` label and **both** humans approve. Announce it in chat before merging, because both sides will need to rebase.

Merge cadence: merge as soon as the task is green. Don't batch. There's a mandatory "merge everything that's ready" sweep at every sync checkpoint.

## 4. Conflict avoidance
- **Folder ownership** (AGENTS.md §4) is the main protection. Two lanes never write the same folder.
- Hot shared files:
  - `package.json` / `package-lock.json`: add dependencies in **your own PR**. If you hit a conflict, take `main`'s lockfile and re‑run `npm install <your-dep>`. Never hand‑merge lockfiles.
  - `.env.example`: append only, in alphabetical order inside its section.
  - `src/shared/contracts.ts`: frozen after T01. Additive changes only (new optional fields), via `contract-change`.
  - `README.md`: one owner per section. Quickstart = Backend lane (T00/T15/A06); screenshots and "How it works" = Frontend lane/QA lane (F08/A05).
- Generated code (shadcn `src/components/ui/**`, drizzle migrations) is committed by the owning lane only.

## 5. Sync checkpoints (15 min max, voice or chat)
| When (CET) | Agenda |
|---|---|
| Tue 14:00 | Kick‑off: read the README and AGENTS.md, share sandbox creds via password manager, confirm both sponsor targets (Render and AG Grid), start T00/F01 |
| Tue 16:00 | Contracts frozen (T01 merged). Collaborator confirms the fixtures match |
| Tue 19:00 | What merged; evening plan (A01 photo shoot) |
| Wed 09:00 | Stand‑up; check Notion for Blocked |
| **Wed 13:00** | **Integration check**: authorize + upload end‑to‑end locally. Cut anything at risk |
| **Wed 18:00** | **MVP freeze**: all MVP merged? Choose ≤ 2 stretch items; deploy plan |
| Wed 23:30 | Hosted URL works? Record a rough backup video tonight in case Thu goes badly |
| Thu 12:30 | Adarsh back from the interview: status, video recording plan |
| **Thu 15:00** | **Code freeze**: only docs/README fixes after this |
| Thu 17:30 | Final check of the Devpost form; submit by 18:00 |

Status lives in **Notion** (not chat). At each checkpoint everyone opens the board filtered to `Status != Done`.

## 6. Communication rules
- Blocked > 20 min → Notion **Blocked** + ping the other human with `BLOCKED <TaskID>: <one line>`.
- Secrets are only ever shared via password manager/Signal. Never in Notion, GitHub, PR comments or agent chats.
- If an agent proposes touching another lane's folder, the human says no and files a Notion task.

## 7. If things go wrong
| Situation | Do |
|---|---|
| `main` broken | Whoever notices posts it. Fix‑forward within 15 min, else `git revert <sha>` via PR |
| PayPal sandbox down or slow | Keep building with mocked `ppFetch` (unit tests); check https://www.paypal-status.com/ (verify URL) |
| AI provider quota/outage | `VISION_MOCK=1`; switch `AI_PROVIDER` |
| Render deploy fails | Demo locally; the hosted URL is nice‑to‑have because README run instructions also satisfy the rules |
| Adarsh unavailable Thu morning | Collaborator owns `main` and merges reviewed PRs on her own (her own PRs: self‑merge allowed if CI is green and the change is UI/e2e only) |
