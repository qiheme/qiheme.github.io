#!/usr/bin/env node
/**
 * Handbook conformance check.
 *
 * Checks a repository against the parts of the Engineering Handbook that a
 * machine can verify: the repo contract (files, script names, Node pin, hooks,
 * CI), the lint and test configuration, and the deploy pipeline.
 *
 *   node audit.mjs [path] [--blueprint <name>] [--json] [--all] [--issues]
 *
 * Exit code: 0 when every required rule is met or listed as a deviation, 1
 * when one is not, 2 on a bad argument.
 *
 * A rule is only as binding as its label in the handbook. Rules the handbook
 * marks Adopted or In use are required. Rules it marks Proposed are reported
 * as TODO and never fail the run: installing this check must not force a
 * change the owner has not signed off.
 *
 * A repo that differs on purpose says so in its own CLAUDE.md: a row in the
 * "Deviations" table whose first cell is the rule id in backticks and whose
 * "Reason" cell is filled in. That rule is then reported as an accepted
 * deviation and does not fail the run.
 *
 * With --issues it prints, as JSON, one GitHub issue draft per required rule
 * that is not met plus a parent issue to hang them on, each written in the
 * Task form. It creates nothing: the audit skill files them.
 *
 * It reports facts only. It does not judge architecture or run anything: that
 * is the audit skill's job (../SKILL.md).
 *
 * No dependencies. Every decision is a pure function over a small "repo" port
 * (exists, read, list), so the tests run against repositories held in memory.
 *
 * Handbook: https://qiheme.github.io/handbook/
 */
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

/**
 * The major versions new projects start on. Keep in step with the "Version
 * baseline" table in standards/stack.md. A repo may trail by one major.
 */
export const BASELINE = {
  react: 19,
  vite: 8,
  vitest: 5,
  eslint: 10,
  astro: 7,
  tailwindcss: 4,
  storybook: 10,
}

export const NODE_MAJOR = '24'

export const BLUEPRINTS = [
  'static-site',
  'web-app',
  'full-stack-app',
  'library',
  'cli',
  'shell',
  'unknown',
]

/** Blueprints that render pages and are deployed to a host. */
const WITH_PAGES = ['static-site', 'web-app', 'full-stack-app']

// --- the repo port -----------------------------------------------------------

/** A repository held in memory: `{ 'path/to/file': 'contents' }`. For tests. */
export function memoryRepo(files) {
  const paths = Object.keys(files)
  return {
    files,
    exists: (p) => p in files || paths.some((f) => f.startsWith(`${p}/`)),
    read: (p) => (p in files ? files[p] : null),
    list: (dir) => {
      const prefix = dir ? `${dir}/` : ''
      const names = paths
        .filter((f) => f.startsWith(prefix))
        .map((f) => f.slice(prefix.length).split('/')[0])
      return [...new Set(names)].sort()
    },
  }
}

/* node:coverage disable */
/** A repository on disk. The only code here that touches the file system. */
export function diskRepo(root) {
  const at = (p) => path.join(root, p)
  return {
    exists: (p) => fs.existsSync(at(p)),
    read: (p) =>
      fs.existsSync(at(p)) && fs.statSync(at(p)).isFile() ? fs.readFileSync(at(p), 'utf8') : null,
    list: (dir) =>
      fs.existsSync(at(dir)) && fs.statSync(at(dir)).isDirectory()
        ? fs.readdirSync(at(dir)).sort()
        : [],
  }
}
/* node:coverage enable */

// --- small readers -----------------------------------------------------------

/** Parse JSON that may have comments and trailing commas, as tsconfig files do. */
function parseLoose(text) {
  if (text === null) return null
  const stripped = text
    .replace(/("(?:[^"\\]|\\.)*")|\/\/[^\n]*|\/\*[\s\S]*?\*\//g, (match, string) => string ?? '')
    .replace(/,(\s*[}\]])/g, '$1')
  try {
    return JSON.parse(stripped)
  } catch {
    return null
  }
}

function readPackage(repo) {
  return parseLoose(repo.read('package.json'))
}

function dependenciesOf(pkg) {
  return { ...(pkg?.dependencies ?? {}), ...(pkg?.devDependencies ?? {}) }
}

/** The major version in a range: "^8.3.4" is 8; "npm:pkg@^6.0.2" is 6. */
export function majorOf(range) {
  if (typeof range !== 'string') return null
  const version = range.includes('@') ? range.slice(range.lastIndexOf('@') + 1) : range
  const match = version.match(/(\d+)/)
  return match ? Number(match[1]) : null
}

const firstExisting = (repo, candidates) => candidates.find((p) => repo.exists(p)) ?? null

// --- blueprint ---------------------------------------------------------------

/** Work out which blueprint a repo follows from what it depends on. */
export function detectBlueprint(repo) {
  if (!repo.exists('package.json')) {
    return repo.list('').some((name) => name.endsWith('.sh')) ? 'shell' : 'unknown'
  }
  const pkg = readPackage(repo)
  if (!pkg) return 'unknown'
  const deps = dependenciesOf(pkg)
  if ('astro' in deps) return 'static-site'
  if ('@tanstack/react-start' in deps) return 'full-stack-app'
  if (pkg.publishConfig || '@changesets/cli' in deps) return 'library'
  if ('react' in deps && ('vite' in deps || 'react-scripts' in deps)) return 'web-app'
  return 'cli'
}

/** Names a rulebook may use on its Blueprint line, and the blueprint each means. */
const DECLARED = {
  'static-site': 'static-site',
  'web-app': 'web-app',
  'full-stack-app': 'full-stack-app',
  library: 'library',
  cli: 'cli',
  'cli-and-scripts': 'cli',
  shell: 'shell',
}

/** The blueprint a repo names in its CLAUDE.md: `**Blueprint:** [Web app](…)`. */
export function declaredBlueprint(repo) {
  const match = (repo.read('CLAUDE.md') ?? '').match(/\*\*Blueprint:\*\*\s*\[([^\]]+)\]/)
  if (!match) return null
  return DECLARED[match[1].trim().toLowerCase().replace(/\s+/g, '-')] ?? null
}

const cellsOf = (row) =>
  row
    .trim()
    .replace(/^\||\|$/g, '')
    .split('|')
    .map((cell) => cell.trim())

/**
 * The deviations a repo lists in its CLAUDE.md. Reads the table under the
 * heading that contains "Deviations": each row whose first cell is a rule id
 * in backticks, with the text of its "Reason" column.
 */
export function readDeviations(repo) {
  const lines = (repo.read('CLAUDE.md') ?? '').split('\n')
  const start = lines.findIndex((line) => /^#{1,6}\s.*deviations/i.test(line))
  if (start === -1) return []
  const rest = lines.slice(start + 1)
  const end = rest.findIndex((line) => /^#{1,6}\s/.test(line))
  const rows = rest
    .slice(0, end === -1 ? rest.length : end)
    .filter((line) => line.trim().startsWith('|'))
  if (rows.length === 0) return []
  const reasonColumn = cellsOf(rows[0]).findIndex((cell) => /^reason$/i.test(cell))
  return rows
    .map(cellsOf)
    .map((cells) => ({
      id: cells[0].match(/^`([a-z0-9-]+)`$/)?.[1],
      reason: cells[reasonColumn] ?? '',
    }))
    .filter((row) => row.id)
}

// --- the checks --------------------------------------------------------------

const pass = (detail = '') => ({ status: 'pass', detail })
const fail = (detail) => ({ status: 'fail', detail })
const na = { status: 'na', detail: 'does not apply to this blueprint' }

/** Each check: id, level, title, the handbook page that states the rule, who it applies to, and the test. */
const CHECKS = [
  {
    id: 'rulebook',
    title: 'CLAUDE.md is the rulebook',
    page: 'standards/agents.md',
    run: ({ repo }) => (repo.exists('CLAUDE.md') ? pass() : fail('CLAUDE.md is missing')),
  },
  {
    id: 'agent-pointers',
    level: 'proposed',
    title: 'Other agent files point to CLAUDE.md instead of copying it',
    page: 'standards/agents.md',
    run: ({ repo }) => {
      if (!repo.exists('AGENTS.md')) return fail('AGENTS.md is missing')
      for (const file of ['AGENTS.md', '.github/copilot-instructions.md']) {
        const text = repo.read(file)
        if (text === null) continue
        const lines = text.split('\n').filter((line) => line.trim()).length
        if (lines > 12)
          return fail(`${file} is a copy of the rules (${lines} lines), not a pointer`)
        if (!text.includes('CLAUDE.md')) return fail(`${file} does not point to CLAUDE.md`)
      }
      return pass()
    },
  },
  {
    id: 'readme',
    title: 'README.md exists',
    page: 'standards/repo-contract.md',
    run: ({ repo }) => (repo.exists('README.md') ? pass() : fail('README.md is missing')),
  },
  {
    id: 'node-pin',
    level: 'proposed',
    title: `.nvmrc pins Node ${NODE_MAJOR} by major version`,
    page: 'standards/stack.md',
    node: true,
    run: ({ repo }) => {
      const pin = repo.read('.nvmrc')
      if (pin === null) return fail('.nvmrc is missing')
      return pin.trim() === NODE_MAJOR
        ? pass()
        : fail(`.nvmrc is "${pin.trim()}", the standard is "${NODE_MAJOR}"`)
    },
  },
  {
    id: 'engines',
    level: 'proposed',
    title: `package.json engines.node is >=${NODE_MAJOR}`,
    page: 'standards/stack.md',
    node: true,
    run: ({ pkg }) => {
      const range = pkg.engines?.node
      return new RegExp(`^>=\\s*${NODE_MAJOR}(\\D|$)`).test(range ?? '')
        ? pass()
        : fail(`engines.node is ${range ? `"${range}"` : 'not set'}`)
    },
  },
  {
    id: 'lockfile',
    title: 'npm, with a committed package-lock.json',
    page: 'standards/stack.md',
    node: true,
    run: ({ repo }) => {
      const other = firstExisting(repo, ['yarn.lock', 'pnpm-lock.yaml', 'bun.lockb', 'bun.lock'])
      if (other) return fail(`${other} found; the standard is npm`)
      return repo.exists('package-lock.json') ? pass() : fail('package-lock.json is missing')
    },
  },
  {
    id: 'esm',
    title: 'ES modules ("type": "module")',
    page: 'standards/stack.md',
    node: true,
    run: ({ pkg }) =>
      pkg.type === 'module' ? pass() : fail('package.json has no "type": "module"'),
  },
  {
    id: 'npmrc-no-token',
    title: 'The committed .npmrc holds no token line',
    page: 'standards/security.md',
    node: true,
    run: ({ repo }) =>
      (repo.read('.npmrc') ?? '').includes('_authToken')
        ? fail('.npmrc has an _authToken line; it belongs in the user-level ~/.npmrc')
        : pass(),
  },
  {
    id: 'env-ignored',
    title: '.env is git-ignored',
    page: 'standards/security.md',
    node: true,
    run: ({ repo }) => {
      const ignore = repo.read('.gitignore')
      if (ignore === null) return fail('.gitignore is missing')
      return ignore.split('\n').some((line) => /^\/?\.env(\.\*|\*)?$/.test(line.trim()))
        ? pass()
        : fail('.gitignore does not ignore .env')
    },
  },
  {
    id: 'scripts',
    title: 'npm scripts use the contract names',
    page: 'standards/repo-contract.md',
    node: true,
    run: ({ pkg, blueprint }) => {
      const wanted = ['lint', 'typecheck', 'test', 'test:coverage']
      if (blueprint !== 'cli') wanted.push('build')
      if (WITH_PAGES.includes(blueprint)) wanted.push('test:e2e')
      const missing = wanted.filter((name) => !pkg.scripts?.[name])
      return missing.length ? fail(`missing scripts: ${missing.join(', ')}`) : pass()
    },
  },
  {
    id: 'test-script',
    title: '`npm test` is one fast run; `test:coverage` is the gate',
    page: 'standards/repo-contract.md',
    node: true,
    run: ({ pkg }) => {
      const test = pkg.scripts?.test
      if (!test) return fail('there is no test script')
      if (test.includes('--coverage'))
        return fail(`test is "${test}"; coverage belongs in test:coverage`)
      if (/^vitest(\s+--\S+)*$/.test(test.trim()))
        return fail(`test is "${test}", which starts watch mode; use "vitest run"`)
      return pass()
    },
  },
  {
    id: 'typescript-strict',
    title: 'TypeScript in strict mode',
    page: 'standards/stack.md',
    node: true,
    run: ({ repo }) => {
      const root = parseLoose(repo.read('tsconfig.json'))
      if (!root) return fail('tsconfig.json is missing or unreadable')
      const referenced = (root.references ?? []).map((ref) =>
        parseLoose(repo.read(path.posix.normalize(ref.path))),
      )
      const strict = [root, ...referenced].some(
        (config) =>
          config?.compilerOptions?.strict === true || /strict/.test(String(config?.extends ?? '')),
      )
      return strict ? pass() : fail('no tsconfig sets "strict": true or extends a strict preset')
    },
  },
  {
    id: 'eslint-flat',
    title: 'ESLint flat config',
    page: 'standards/stack.md',
    node: true,
    run: ({ repo }) => {
      const legacy = repo.list('').find((name) => name.startsWith('.eslintrc'))
      if (legacy) return fail(`${legacy} is the legacy format; use eslint.config.js`)
      return firstExisting(repo, ['eslint.config.js', 'eslint.config.mjs', 'eslint.config.ts'])
        ? pass()
        : fail('there is no eslint.config file')
    },
  },
  {
    id: 'coverage-100',
    title: 'Coverage thresholds are 100% on all four metrics',
    page: 'standards/testing.md',
    node: true,
    run: ({ repo }) => {
      const configs = repo
        .list('')
        .filter((name) => /^(vitest|vite)\.config\.[cm]?[jt]s$/.test(name))
      const text = configs
        .map((name) => repo.read(name))
        .find((source) => source.includes('thresholds'))
      if (!text) return fail('no Vitest config sets coverage thresholds')
      const low = ['lines', 'functions', 'branches', 'statements'].filter(
        (metric) => !new RegExp(`\\b${metric}\\s*:\\s*100\\b`).test(text),
      )
      return low.length ? fail(`not pinned at 100: ${low.join(', ')}`) : pass()
    },
  },
  {
    id: 'hooks',
    title: 'husky: lint staged files on commit, typecheck and coverage on push',
    page: 'standards/ci-cd.md',
    node: true,
    run: ({ repo }) => {
      if (!(repo.read('.husky/pre-commit') ?? '').includes('lint-staged')) {
        return fail('.husky/pre-commit does not run lint-staged')
      }
      const push = repo.read('.husky/pre-push') ?? ''
      return push.includes('typecheck') && push.includes('test:coverage')
        ? pass()
        : fail('.husky/pre-push does not run typecheck and test:coverage')
    },
  },
  {
    id: 'ci',
    title: 'CI runs lint, typecheck, coverage and build on the pinned Node',
    page: 'standards/ci-cd.md',
    node: true,
    run: ({ repo, blueprint }) => {
      const ci = repo.read('.github/workflows/ci.yml')
      if (ci === null) return fail('.github/workflows/ci.yml is missing')
      const wanted = [
        'node-version-file',
        'npm run lint',
        'npm run typecheck',
        'npm run test:coverage',
      ]
      if (blueprint !== 'cli') wanted.push('npm run build')
      const missing = wanted.filter((text) => !ci.includes(text))
      return missing.length ? fail(`ci.yml has no: ${missing.join(', ')}`) : pass()
    },
  },
  {
    id: 'ci-secret-name',
    title: 'CI installs Cobalt with the COBALT_PACKAGES_TOKEN secret',
    page: 'standards/ci-cd.md',
    node: true,
    run: ({ repo, deps }) => {
      const ci = repo.read('.github/workflows/ci.yml')
      if (ci === null || !('@q-labs/cobalt' in deps)) return pass('no private package to install')
      return ci.includes('COBALT_PACKAGES_TOKEN')
        ? pass()
        : fail('ci.yml does not use the COBALT_PACKAGES_TOKEN secret')
    },
  },
  {
    id: 'netlify-pipeline',
    title: 'Netlify pipeline: preview and release workflows',
    page: 'standards/ci-cd.md',
    blueprints: WITH_PAGES,
    run: ({ repo }) => {
      const missing = [
        'netlify.toml',
        '.github/workflows/deploy-preview.yml',
        '.github/workflows/release.yml',
      ].filter((file) => !repo.exists(file))
      return missing.length ? fail(`missing: ${missing.join(', ')}`) : pass()
    },
  },
  {
    id: 'no-vercel',
    title: 'Not deployed to Vercel',
    page: 'standards/ci-cd.md',
    blueprints: WITH_PAGES,
    run: ({ repo, deps }) => {
      if (repo.exists('vercel.json')) return fail('vercel.json found; the standard host is Netlify')
      return '@astrojs/vercel' in deps
        ? fail('@astrojs/vercel adapter found; the standard host is Netlify')
        : pass()
    },
  },
  {
    id: 'cobalt',
    title: 'Built on the Cobalt design system',
    page: 'standards/ui.md',
    blueprints: WITH_PAGES,
    run: ({ deps }) =>
      '@q-labs/cobalt' in deps
        ? pass(`@q-labs/cobalt ${deps['@q-labs/cobalt']}`)
        : fail('@q-labs/cobalt is not a dependency'),
  },
  {
    id: 'versions',
    level: 'proposed',
    title: 'Frameworks are within one major version of the baseline',
    page: 'standards/stack.md',
    node: true,
    run: ({ deps }) => {
      const behind = Object.entries(BASELINE)
        .map(([name, baseline]) => ({ name, baseline, major: majorOf(deps[name]) }))
        .filter(({ major, baseline }) => major !== null && baseline - major >= 2)
        .map(({ name, major, baseline }) => `${name} ${major} (baseline ${baseline})`)
      return behind.length ? fail(`two or more majors behind: ${behind.join(', ')}`) : pass()
    },
  },
  {
    id: 'pr-template',
    title: 'Pull request template',
    page: 'standards/repo-contract.md',
    run: ({ repo }) =>
      firstExisting(repo, ['.github/pull_request_template.md', '.github/PULL_REQUEST_TEMPLATE.md'])
        ? pass()
        : fail('.github/pull_request_template.md is missing'),
  },
  {
    id: 'issue-forms',
    title: 'Feature, Bug and Task issue forms',
    page: 'standards/repo-contract.md',
    run: ({ repo }) => {
      const missing = ['feature.yml', 'bug.yml', 'task.yml'].filter(
        (file) => !repo.exists(`.github/ISSUE_TEMPLATE/${file}`),
      )
      return missing.length
        ? fail(`missing in .github/ISSUE_TEMPLATE: ${missing.join(', ')}`)
        : pass()
    },
  },
  {
    id: 'verify-skill',
    title: 'A verify skill says how to prove a change at runtime',
    page: 'standards/agents.md',
    node: true,
    run: ({ repo }) =>
      repo.exists('.claude/skills/verify/SKILL.md')
        ? pass()
        : fail('.claude/skills/verify/SKILL.md is missing'),
  },
  {
    id: 'shell-tests',
    title: 'One test.sh runs lint and tests',
    page: 'blueprints/cli-and-scripts.md',
    blueprints: ['shell'],
    run: ({ repo }) => (repo.exists('test.sh') ? pass() : fail('test.sh is missing')),
  },
  {
    id: 'shell-ci',
    title: 'CI runs the tests',
    page: 'blueprints/cli-and-scripts.md',
    blueprints: ['shell'],
    run: ({ repo }) =>
      repo.list('.github/workflows').some((name) => /\.ya?ml$/.test(name))
        ? pass()
        : fail('no workflow in .github/workflows'),
  },
  {
    id: 'quality-spec',
    level: 'proposed',
    title: 'The Front-End Checklist spec is in the end-to-end suite',
    page: 'standards/frontend-checklist.md',
    blueprints: WITH_PAGES,
    run: ({ repo }) =>
      firstExisting(repo, ['e2e/quality.spec.ts', 'tests/e2e/quality.spec.ts'])
        ? pass()
        : fail('quality.spec.ts is not in e2e/ or tests/e2e/'),
  },
  {
    id: 'security-headers',
    level: 'proposed',
    title: 'Security headers are set',
    page: 'standards/frontend-checklist.md',
    blueprints: WITH_PAGES,
    run: ({ repo }) => {
      const headers = repo.read('public/_headers')
      if (headers === null) return fail('public/_headers is missing')
      return headers.includes('X-Content-Type-Options')
        ? pass()
        : fail('public/_headers sets no X-Content-Type-Options header')
    },
  },
  {
    id: 'prettier',
    level: 'proposed',
    title: 'Prettier is configured',
    page: 'standards/stack.md',
    node: true,
    run: ({ repo }) =>
      firstExisting(repo, [
        '.prettierrc.json',
        '.prettierrc',
        'prettier.config.js',
        'prettier.config.mjs',
      ])
        ? pass()
        : fail('no Prettier config'),
  },
  {
    id: 'dependabot',
    level: 'proposed',
    title: 'Dependabot keeps dependencies moving',
    page: 'standards/ci-cd.md',
    node: true,
    run: ({ repo }) =>
      repo.exists('.github/dependabot.yml') ? pass() : fail('.github/dependabot.yml is missing'),
  },
]

/** Does a check apply to this repo? */
function applies(check, { blueprint, pkg }) {
  if (check.blueprints) return check.blueprints.includes(blueprint)
  if (check.node) return pkg !== null
  return true
}

/**
 * Audit a repo.
 * @param repo  the port: { exists(path), read(path), list(dir) }
 * @param options.blueprint  skip detection and use this blueprint
 */
export function audit(repo, options = {}) {
  const declared = declaredBlueprint(repo)
  const blueprint = options.blueprint ?? declared ?? detectBlueprint(repo)
  const pkg = readPackage(repo)
  const context = { repo, blueprint, pkg, deps: dependenciesOf(pkg) }
  const deviations = readDeviations(repo)
  const reasonFor = (id) => deviations.find((d) => d.id === id)?.reason

  const checks = CHECKS.map((check) => {
    const outcome = applies(check, context) ? check.run(context) : na
    const reason = reasonFor(check.id)
    const accepted = outcome.status === 'fail' && reason ? { status: 'deviation', reason } : {}
    return {
      id: check.id,
      level: check.level ?? 'required',
      title: check.title,
      page: check.page,
      ...outcome,
      ...accepted,
    }
  })

  // The list itself is checked, so it cannot hide a gap by accident.
  const problems = deviations.flatMap(({ id, reason }) => {
    const check = checks.find((c) => c.id === id)
    if (!check) return [`unknown rule \`${id}\``]
    if (!reason) return [`\`${id}\` has no reason`]
    return check.status === 'deviation'
      ? []
      : [`\`${id}\` is listed but the rule is met; remove the row`]
  })
  checks.push({
    id: 'deviations',
    level: 'required',
    title: 'Every listed deviation names a real rule, gives a reason, and is still true',
    page: 'standards/agents.md',
    ...(problems.length ? fail(`in CLAUDE.md: ${problems.join('; ')}`) : pass()),
  })

  const count = (level, status) =>
    checks.filter((c) => c.level === level && c.status === status).length
  const summary = {
    pass: checks.filter((c) => c.status === 'pass').length,
    fail: count('required', 'fail'),
    proposed: count('proposed', 'fail'),
    deviation: checks.filter((c) => c.status === 'deviation').length,
    na: checks.filter((c) => c.status === 'na').length,
  }
  return {
    blueprint,
    blueprintSource: options.blueprint ? 'given' : declared ? 'declared' : 'detected',
    ok: summary.fail === 0,
    summary,
    checks,
  }
}

// --- from findings to issues -------------------------------------------------

/** Where the handbook's pages are read on GitHub. Survives a branch rename. */
export const HANDBOOK = 'https://github.com/qiheme/handbook/blob/HEAD/'

const SIZES = {
  XS: 'XS - under 2 hours',
  S: 'S - half day',
  M: 'M - one weekend',
  L: 'L - multi-weekend',
  XL: 'XL - needs scoping (split into sub-issues)',
}
/** Rough hours behind each size, used only to size the parent issue. */
const HOURS = { XS: 1, S: 4, M: 16, L: 40 }

/**
 * For each rule: what to do about it, why it matters, and a rough size.
 * This is the text an issue is written from, so it is the same every time.
 */
export const GUIDANCE = {
  rulebook: {
    fix: "Add `CLAUDE.md` from the handbook's `kit/common/CLAUDE.template.md`. Replace every placeholder and list any deviations.",
    why: 'Agents load the rulebook at the start of every session. Without it they work from memory, which is how the repos drifted apart.',
    size: 'S',
  },
  'agent-pointers': {
    fix: 'Add `AGENTS.md` from `kit/common/AGENTS.template.md`, and replace `.github/copilot-instructions.md` (if present) with the one-line pointer from the kit.',
    why: 'A second copy of the rules goes stale. A pointer to `CLAUDE.md` cannot.',
    size: 'XS',
  },
  readme: {
    fix: 'Write `README.md` with the sections listed in `standards/repo-contract.md`.',
    why: 'It is the first thing a person or an agent reads, and the only place setup steps live.',
    size: 'S',
  },
  'node-pin': {
    fix: `Set \`.nvmrc\` to \`${NODE_MAJOR}\`, the major version only.`,
    why: 'One Node version across the repos means one CI setup and one cloud setup.',
    size: 'XS',
  },
  engines: {
    fix: `Set \`engines.node\` to \`>=${NODE_MAJOR}\` in \`package.json\`.`,
    why: 'It stops an install on a Node version the repo is not tested on.',
    size: 'XS',
  },
  lockfile: {
    fix: 'Use npm: commit `package-lock.json` and remove any other lockfile.',
    why: 'CI runs `npm ci`, which needs the lockfile. One package manager means one lockfile format.',
    size: 'XS',
  },
  esm: {
    fix: 'Add `"type": "module"` to `package.json` and convert any CommonJS files.',
    why: 'Every active repo uses ES modules, and the kit configs assume it.',
    size: 'S',
  },
  'npmrc-no-token': {
    fix: 'Remove the `_authToken` line from the committed `.npmrc`, keeping only the `@q-labs` registry line. The token goes in the user-level `~/.npmrc`; CI uses the `COBALT_PACKAGES_TOKEN` secret.',
    why: 'A token line in a committed file is one edit away from a leaked token.',
    size: 'XS',
  },
  'env-ignored': {
    fix: 'Add `.env`, `.env.*` and `!.env.example` to `.gitignore`.',
    why: 'Nothing else stops a file of secrets from being committed.',
    size: 'XS',
  },
  scripts: {
    fix: 'Add the missing npm scripts under the contract names in `standards/repo-contract.md`. `kit/common/package.scripts.json` has them.',
    why: 'CI, the hooks and agents all call these names. A repo without them needs special handling everywhere.',
    size: 'S',
  },
  'test-script': {
    fix: 'Make `test` a single run (`vitest run`) and put coverage in `test:coverage`.',
    why: '`npm test` is the fast loop. `test:coverage` is the gate the hooks and CI call.',
    size: 'XS',
  },
  'typescript-strict': {
    fix: 'Set `"strict": true` in `tsconfig.json` (or extend a strict preset) and fix what it reports. In a JavaScript repo this is the TypeScript migration: file by file, pure modules first.',
    why: 'Types catch what tests miss, and strict mode is where most of that value is.',
    size: 'L',
  },
  'eslint-flat': {
    fix: 'Add `eslint.config.js` from `kit/common/eslint.config.js`, remove any `.eslintrc*` file, and fix what it reports.',
    why: 'One lint configuration across the repos, in the only format current ESLint reads.',
    size: 'S',
  },
  'coverage-100': {
    fix: 'Pin the Vitest coverage thresholds at 100 for lines, functions, branches and statements (see `kit/common/vitest.config.ts`), then write the tests the gate asks for.',
    why: 'The coverage floor is how an agent knows a change is finished. Below 100 it erodes.',
    size: 'M',
  },
  hooks: {
    fix: 'Add the husky hooks from `kit/common/.husky/`: lint-staged on commit; typecheck and test:coverage on push.',
    why: 'They catch a failure before CI does, and push-time gates let the red commit of a test-first cycle through.',
    size: 'XS',
  },
  ci: {
    fix: 'Bring `.github/workflows/ci.yml` in line with `kit/workflows/ci.yml`: Node from `.nvmrc`, then lint, typecheck, test:coverage and build.',
    why: 'CI is the gate that cannot be skipped. Each missing step is a class of mistake that reaches the default branch.',
    size: 'S',
  },
  'ci-secret-name': {
    fix: 'Create the `COBALT_PACKAGES_TOKEN` Actions secret (the owner does this) and use it in `ci.yml` in place of the current name.',
    why: 'One secret name means the kit workflows work in every repo unchanged.',
    size: 'XS',
  },
  'netlify-pipeline': {
    fix: 'Add `netlify.toml`, `deploy-preview.yml` and `release.yml` from the kit. The owner adds the Netlify secrets.',
    why: 'One host and one pipeline: tests gate every deploy, every pull request gets a preview, and rollback is one click.',
    size: 'M',
  },
  'no-vercel': {
    fix: 'Move the site to Netlify with the kit pipeline. Server code on Vercel Functions or Vercel Cron moves first (`blueprints/functions.md`).',
    why: 'Two hosts means two pipelines to maintain. The owner decided on one host: decision D1 in the handbook.',
    size: 'L',
  },
  cobalt: {
    fix: 'Install `@q-labs/cobalt` and build the interface on its components and tokens (`standards/ui.md`).',
    why: 'One design system across the products, instead of a palette per repo.',
    size: 'L',
  },
  versions: {
    fix: 'Upgrade the frameworks named above to within one major version of the baseline in `standards/stack.md`.',
    why: 'Two majors behind, an upgrade stops being routine and the repos stop sharing configuration.',
    size: 'M',
  },
  'pr-template': {
    fix: 'Add `.github/pull_request_template.md` from `kit/common/.github/`.',
    why: 'Every pull request then asks for the linked issue and for evidence the change works at runtime.',
    size: 'XS',
  },
  'issue-forms': {
    fix: 'Add the Feature, Bug and Task forms from `kit/common/.github/ISSUE_TEMPLATE/`, and enable Issue Types in the repository settings.',
    why: 'Work starts with an issue. The forms make each one complete enough to act on.',
    size: 'XS',
  },
  'verify-skill': {
    fix: "Add `.claude/skills/verify/SKILL.md` from `kit/common/claude-skill-verify/SKILL.template.md`, with this repo's real build, serve and drive commands.",
    why: 'It tells an agent how to prove a change works in the running app, not only in tests.',
    size: 'S',
  },
  'shell-tests': {
    fix: 'Add a `test.sh` that runs shellcheck, the syntax checks and the bats tests.',
    why: 'One entry point means CI and a person run exactly the same checks.',
    size: 'S',
  },
  'shell-ci': {
    fix: 'Add a workflow in `.github/workflows/` that runs `test.sh`.',
    why: 'Without CI the tests only run when someone remembers to.',
    size: 'XS',
  },
  'quality-spec': {
    fix: 'Add `kit/e2e/quality.spec.ts` to the end-to-end suite, list every route in it, and fix what it reports.',
    why: 'It automates the Front-End Checklist rules a machine can check, on every pull request.',
    size: 'S',
  },
  'security-headers': {
    fix: "Add `public/_headers` from `kit/netlify/_headers` and write the app's Content-Security-Policy.",
    why: 'The Front-End Checklist rates these headers High, and the host does not set them all by default.',
    size: 'S',
  },
  prettier: {
    fix: 'Add `.prettierrc.json` from the kit and format the repo in one commit.',
    why: 'A formatter ends style differences between repos and shrinks every later diff.',
    size: 'S',
  },
  dependabot: {
    fix: 'Add `.github/dependabot.yml` from `kit/common/.github/`.',
    why: 'Nothing else keeps the repos on the same framework versions.',
    size: 'XS',
  },
}

/** The size of a piece of work made of these sizes. Two small tasks are not one small task. */
export function totalSize(sizes) {
  const hours = sizes.reduce((sum, size) => sum + HOURS[size], 0)
  if (hours <= 1) return 'XS'
  if (hours <= 8) return 'S'
  if (hours <= 24) return 'M'
  if (hours <= 60) return 'L'
  return 'XL'
}

/**
 * Issue drafts for an audit result: one per required rule that is not met,
 * and a parent to attach them to. Each is written in the Task form.
 *
 * Titles end with the rule id and never change, so a later audit can find the
 * issue it already filed. `{{parent}}` in a finding's body stands for the
 * parent issue's number, which only exists once the parent has been created.
 *
 * @param options.name   the repository's name
 * @param options.today  the audit date, YYYY-MM-DD
 */
export function issueDrafts(result, { name, today }) {
  const failed = result.checks.filter((c) => c.level === 'required' && c.status === 'fail')
  if (failed.length === 0) return { parent: null, findings: [] }
  const proposed = result.checks.filter((c) => c.level === 'proposed' && c.status === 'fail')
  const accepted = result.checks.filter((c) => c.status === 'deviation')
  const run = 'node .claude/skills/handbook-audit/scripts/audit.mjs .'

  const findings = failed.map((check) => {
    const { fix, why, size } = GUIDANCE[check.id]
    return {
      rule: check.id,
      size,
      title: `[Infra] Handbook audit: ${check.title} (${check.id})`,
      body: [
        '### What',
        '',
        fix,
        '',
        `**Found:** ${check.detail}`,
        '',
        '### Why now',
        '',
        `${why} The rule is in the Engineering Handbook: [\`${check.page}\`](${HANDBOOK}${check.page}).`,
        '',
        '### Done when',
        '',
        `- [ ] The audit no longer reports \`${check.id}\` (\`${run}\`), or the repo lists it as a deviation in \`CLAUDE.md\` with a reason`,
        "- [ ] The repo's lint, typecheck, coverage and build gates pass",
        '- [ ] Docs are updated if behaviour or structure changed',
        '',
        '### Parent issue',
        '',
        '#{{parent}}',
        '',
        '### Effort estimate',
        '',
        SIZES[size],
        '',
        '---',
        `Audit rule: \`${check.id}\` · filed by the handbook-audit skill`,
      ].join('\n'),
    }
  })

  const parent = {
    title: `Handbook audit: bring ${name} up to the Engineering Handbook standard`,
    body: [
      '### What',
      '',
      `Close the gaps between this repository and the [Engineering Handbook](${HANDBOOK}README.md). Audited on ${today} (blueprint: ${result.blueprint}): ${plural(failed.length, 'required rule')} not met. Each one is a sub-issue of this issue.`,
      '',
      '| Rule | Found | Size |',
      '| --- | --- | --- |',
      ...findings.map((f, i) => `| \`${f.rule}\` | ${failed[i].detail} | ${f.size} |`),
      '',
      '### Why now',
      '',
      'Every repo on the same frameworks and infrastructure means a person or an agent can work in any of them without relearning it, and a fix to the shared kit reaches all of them.',
      '',
      '### Done when',
      '',
      '- [ ] Every sub-issue is closed, or its rule is listed as a deviation in `CLAUDE.md` with a reason',
      `- [ ] \`${run}\` prints no \`FAIL\``,
      '- [ ] The conformance job runs in CI on every pull request',
      "- [ ] The repo's row in the handbook's `adoption.md` is updated",
      '',
      '### Proposed rules not yet met',
      '',
      proposed.length
        ? `Not filed as issues: these are proposals in the handbook's \`decisions.md\`, not yet binding. ${proposed.map((c) => `\`${c.id}\``).join(', ')}.`
        : 'None.',
      '',
      '### Accepted deviations',
      '',
      ...(accepted.length ? accepted.map((c) => `- \`${c.id}\`: ${c.reason}`) : ['None.']),
      '',
      '### Effort estimate',
      '',
      SIZES[totalSize(findings.map((f) => f.size))],
      '',
      '---',
      'Filed by the handbook-audit skill',
    ].join('\n'),
  }
  return { parent, findings }
}

// --- output ------------------------------------------------------------------

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`

/** The report as text: required failures, then proposed ones, then (with all) the rest. */
export function format(result, name, options = {}) {
  const row = (label, check) =>
    `${label.padEnd(5)} ${check.id.padEnd(18)} ${check.detail}\n      ${check.page}`
  const plain = (label, check) => `${label.padEnd(5)} ${check.id.padEnd(18)} ${check.title}`
  const where = (status, level) =>
    result.checks.filter((c) => c.status === status && (!level || c.level === level))
  const failed = where('fail', 'required')
  const todo = where('fail', 'proposed')
  const accepted = where('deviation')
  const lines = [
    `Handbook audit: ${name}`,
    `Blueprint: ${result.blueprint} (${result.blueprintSource})`,
    '',
  ]

  lines.push(...failed.map((check) => row('FAIL', check)))
  lines.push(...todo.map((check) => row('TODO', check)))
  lines.push(...accepted.map((check) => `${row('DEV', check)}\n      accepted: ${check.reason}`))
  if (options.all) {
    lines.push(...where('pass').map((check) => plain('PASS', check)))
    lines.push(...where('na').map((check) => plain('N/A', check)))
  }
  if (lines.length > 3) lines.push('')

  const { summary } = result
  const deviations = plural(summary.deviation, 'accepted deviation')
  const tail = `${summary.pass} passed, ${summary.na} not applicable`
  if (failed.length + todo.length > 0) {
    lines.push(
      `${plural(summary.fail, 'required rule')} not met, ${plural(summary.proposed, 'proposed rule')} not met, ${deviations}, ${tail}.`,
    )
  } else if (summary.deviation > 0) {
    lines.push(`Meets every rule that was checked, with ${deviations} (${tail}).`)
  } else {
    lines.push(`Meets every rule that was checked (${tail}).`)
  }
  return lines.join('\n')
}

// --- command line ------------------------------------------------------------

const USAGE = `Usage: node audit.mjs [path] [--blueprint <name>] [--json] [--all] [--issues]

  path         the repository to check (default: the current directory)
  --blueprint  one of: ${BLUEPRINTS.filter((b) => b !== 'unknown').join(', ')} (default: detected)
  --json       print the full result as JSON
  --all        also list the rules that passed or did not apply
  --issues     print, as JSON, an issue draft for each required rule not met

Exit code: 0 when every required rule is met, 1 when one is not.`

export function parseArgs(argv) {
  const args = {
    path: '.',
    json: false,
    issues: false,
    all: false,
    blueprint: undefined,
    help: false,
  }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--json') args.json = true
    else if (arg === '--issues') args.issues = true
    else if (arg === '--all') args.all = true
    else if (arg === '--help' || arg === '-h') args.help = true
    else if (arg === '--blueprint') args.blueprint = argv[(i += 1)]
    else args.path = arg
  }
  return args
}

/**
 * @param io.openRepo  path -> repo port
 * @param io.print     line -> void
 * @param io.name      path -> the name to show in the report
 * @param io.today     () -> today's date, YYYY-MM-DD (used only by --issues)
 */
export function main(argv, io) {
  const args = parseArgs(argv)
  if (args.help) {
    io.print(USAGE)
    return 0
  }
  if (args.blueprint !== undefined && !BLUEPRINTS.includes(args.blueprint)) {
    io.print(`Unknown blueprint "${args.blueprint}".\n\n${USAGE}`)
    return 2
  }
  const result = audit(io.openRepo(args.path), { blueprint: args.blueprint })
  const name = io.name(args.path)
  if (args.issues) {
    io.print(JSON.stringify(issueDrafts(result, { name, today: io.today() }), null, 2))
  } else {
    io.print(args.json ? JSON.stringify(result, null, 2) : format(result, name, { all: args.all }))
  }
  return result.ok ? 0 : 1
}

/* node:coverage disable */
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2), {
    openRepo: (target) => diskRepo(path.resolve(target)),
    print: (line) => console.log(line),
    name: (target) => path.basename(path.resolve(target)),
    today: () => new Date().toISOString().slice(0, 10),
  })
}
/* node:coverage enable */
