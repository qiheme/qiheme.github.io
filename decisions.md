# Decisions

Every choice in this handbook that is not yet settled, in one place. Each has a recommendation, the runner-up, and what it affects.

- **Proposed** means the handbook already tells new work to do this. Saying yes settles it. Saying no means changing the handbook.
- **In use** rules (one repo does it, and it works there) are not listed here. They are that repo's own settled choice, and become Adopted when a second repo follows.
- **Open** means the handbook does not pick. Someone has to.

To decide one: comment on the handbook's tracking issue or open a PR that changes the status here and on the page it links to.

## Needs a yes or no

| # | Decision | Recommendation | Runner-up | Why the recommendation | Affects |
| --- | --- | --- | --- | --- | --- |
| D2 | Node version | **Node 24**, pinned as the major `24` | Node 26, the newest LTS | Two repos are already on 24 and it is supported until April 2028. Move to 26 after May 2027 | Six repos, the cloud setup script |
| D4 | Code formatter | **Prettier**: no semicolons, single quotes, width 100 | Biome; or no formatter | The repos disagree on style today and no formatter enforces any. This style matches three of them | Every Node repo: one large formatting commit each |
| D6 | App releases | **Version bump in the PR, tag on merge**, generated notes | semantic-release, computed from commit messages | Two repos do it this way, with a rollback path. semantic-release would be a second system to learn and maintain | Repos with no release workflow yet |
| D7 | Public build-time values | **GitHub Actions variables**, for previews and production | Keep production values in Netlify and pull them with `netlify build` | Netlify never builds, so the build's inputs belong where the build runs. One repo does the runner-up for production today, which also works | easy-finances production build |
| D8 | Styling on content sites | **Tailwind on Cobalt tokens** for new sites | Plain CSS on Cobalt tokens | One approach across every blueprint. Existing plain-CSS sites are not converted | New static sites |
| D9 | Default branch | **`main`** everywhere | Leave three repos on `master` | The kit's workflows name the branch. One name means no per-repo edits | cloud129-site, portfolio, this repo |
| D10 | TypeScript for the one JavaScript app | **Migrate**, file by file, pure modules first | Leave it as JavaScript | It is the largest codebase and the only one without types. Large effort; no user-visible change | easy-finances |
| D11 | Dependency updates | **Dependabot**, weekly, minor and patch grouped | Renovate; or by hand | Vitest is on four majors across the repos. Built into GitHub, no new vendor | Every Node repo |
| D12 | Protect `main` | **Require the CI check; no direct pushes** | No protection | The gate that cannot be skipped should not be skippable | Every repo |
| D14 | This handbook is public | **Keep it public**, with stack-level facts only | Make the repo private, or move the handbook to a private repo | Agents and new developers can read it with no access setup. The cost is care about what goes in | This repo |
| D15 | Front-end quality bar | **Adopt the Front-End Checklist** (frontendchecklist.io). Critical rules block a merge; High rules are required for new work and before launch | Keep the five-line accessibility baseline and nothing else | A maintained, prioritised list that agents can read and audit against. The cost is an audit of each existing site | Every repo with an interface |
| D16 | Automate the checkable rules | **`quality.spec.ts` in every Playwright suite**, which adds `@axe-core/playwright` as a dev dependency | Rely on agent review alone | A check that runs on every PR does not depend on anyone remembering. One new dependency | Every repo with pages |
| D17 | Security headers | **A `_headers` file in every Netlify site**, plus a Content-Security-Policy per app | Set headers in `netlify.toml`; or leave Netlify's defaults | A file in `public/` travels with the prebuilt upload, so previews and production get the same headers | Every deployed repo |
| D18 | Conformance check in CI | **Run `audit.mjs` on every pull request** in each repo, as a required check once that repo's existing gaps are closed or listed as deviations | Run it only on request, through the audit skill | It is what keeps a repo conforming after setup. Turned on too early it fails every pull request | Every repo |
| D19 | Other agent files | **`AGENTS.md` and Copilot's file are one-line pointers to `CLAUDE.md`** | Keep a full copy of the rules in each file | Three repos keep copies and they have already drifted apart. Agents that read `AGENTS.md` find nothing today | Every repo |
| D20 | Version rule | **A repo may trail the baseline by one major version; two behind is a Task** | No rule; upgrade when something breaks | Vitest is on four majors across the repos. Without a line, "later" has no meaning | Every Node repo |
| D22 | Architecture documents | **Three pages in the repo**: `docs/architecture.md` as built, one target page per epic that changes data, server code, hosting, a service or a dependency, written before the first story | A wiki or a design tool outside the repo; or the README alone | In the repo they are reviewed in the pull request and change with the code. The first baseline written this way found a production build seven months behind `main`. Being tried in one repo | Every deployed repo, when it next starts an epic of that kind |
| D23 | Where a decision is recorded | **One short record per decision** in `docs/decisions/`, with its runner-up and what would reopen it. A new runtime dependency always has one | Record decisions in issue comments and pull request bodies | A comment is found by whoever remembers it exists. A record is found by whoever opens the folder | Every repo with a `docs/` folder |
| D24 | A table or a JSON column | **A table for anything added one at a time or that must not be lost; one user action is one row write; items in a JSON list carry ids; write the column you changed** | Leave it to each repo | One app stores a trip's details as six JSON documents written whole, which lets two devices overwrite each other. The rule is what its target architecture came to | Browser-direct apps, for new data |
| D25 | What a write returns | **Every data-layer function returns a result, and the screen shows "saved" only after the server confirms** | Change the screen first and log a failed write | The same rule the handbook already has for server code. A swallowed error is indistinguishable from a save | Web apps |

## Open

| # | Question | Options | Who decides, and where |
| --- | --- | --- | --- |
| O1 | Auth for server-only (full-stack) apps | Supabase Auth, or Better-Auth | The owner, in the first project that needs it. Until then the handbook leans to Supabase Auth: one sign-in system to run |
| O2 | Host and pipeline for server-rendered apps | Netlify with Nitro's Netlify preset is the starting point | Whoever ships the first deploy on the full-stack blueprint. It is unproven |
| O4 | Mobile | Installable web app first; Expo if the device is needed | Decide on the first real mobile project. See [Not built yet](blueprints/other.md#mobile-app) |
| O6 | Error monitoring in production | A hosted error tracker, or none | The checklist rates it High and no repo has it. A new vendor and a new dependency, so it starts with an issue |
| O7 | Browsers in end-to-end tests | Chromium only, or add Firefox and WebKit | The checklist rates cross-browser testing High. More browsers means slower CI. Decide per project, starting with the public sites |
| O8 | Performance budget in CI | Lighthouse CI or a bundle-size check, or measure by hand at launch | The checklist rates Core Web Vitals High. Nothing measures them automatically today |
| O9 | How a web app and its Edge Functions share pure code | One folder both runtimes import, with explicit file extensions; or a copy step; or keep the logic only in `supabase/functions/_shared/` and have the app import from there | The first repo to move a function that shares logic with its app. `Travel-OS` has an issue for it |
| O10 | What data a pull-request preview uses | The production project through row-level security (what the kit does today); demo mode on fixtures with no database client; or a second project migrated by CI | `Travel-OS` is trying demo mode. Decide here once it has run |

## Already settled

**Decided by the owner:**

- **D1, one host:** Netlify hosts every site and app, built on GitHub Actions. The two repos on Vercel move. One pipeline to maintain, and tests gate every deploy. Issue #13.
- **D3, router and server data for new web apps:** TanStack Router and TanStack Query. The same pair as the full-stack blueprint, so an app can grow without a rewrite. An existing React Router app keeps its router. Issue #13.
- **D5, migrations for browser-direct apps:** Supabase CLI file naming, applied by `supabase db push` in the release workflow. Not yet proven in a repo. The one repo with its own runner keeps it. Issue #13.
- **D21, deploys:** every merge is tagged, and production deploys only from the tag. A tag names exactly what is live, and a rollback is a re-run with an older tag. No repo runs it yet. Issue #13.
- **O3, how Edge Functions are deployed:** by the release workflow, with `supabase functions deploy`. Not yet done in any repo: the first to do it writes the steps on the [Functions](blueprints/functions.md) page. Issue #13.
- **O5, scheduled jobs:** Supabase Cron calling the function. Not yet done in any repo. Issue #13.
- **D28, issue titles:** a title starts with the kind of work in brackets (`[UI]`, `[Data]`, `[Logic]`, `[API]`, `[Infra]`, `[QA]`, `[Content]`, `[Docs]`, `[DS]`), not the issue type. The type badge already shows the type, and the kind is what makes a list of stories scannable. Issue #15.
- **D26, Storybook:** every React app and library runs Storybook 10, with a story file for every component, one story per variant and state. CI builds it. Static sites are exempt: Storybook's own frameworks do not render `.astro` components. Issue #10.
- **D27, JSDoc:** every export in `src/` of a static site, web app or full-stack app has a JSDoc comment, enforced by `eslint-plugin-jsdoc` in the kit's lint config. Issue #10.
- **D13, `stock-cerebro-client`:** its features (watchlist, quotes, market news) move into `easy-finances`, rebuilt on that repo's stack, and the repo is archived once they ship. Tracked in that repo's epic for the move. Its 13 audit findings are not filed one by one, because the code is being retired, not fixed.

For the record, these came out of the survey with no real contest: TypeScript, npm, React and Vite, Astro for content, Supabase, Cobalt, Vitest at 100% coverage, Playwright, ESLint flat config, husky, GitHub Actions, issue first, test first, conventional commits, `CLAUDE.md` as the rulebook. Reasons are on [The stack](standards/stack.md).

## How a decision gets recorded

1. A PR to this repo changes the row's status here and on the page that states the rule.
2. If the decision changes what a repo should do, [Adoption](adoption.md) gets a row.
3. Decided rows move to "Already settled" with a one-line reason. Rejected ones are deleted along with the rule they proposed.
