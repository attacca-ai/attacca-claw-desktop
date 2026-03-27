/**
 * electron-builder afterPack hook.
 *
 * electron-builder strips all `node_modules` directories from `extraResources`.
 * OpenClaw has ~50 runtime dependencies that must be available when the gateway
 * child process runs.
 *
 * Strategy:
 *   1. Copy back nested node_modules that electron-builder stripped (openclaw + extensions)
 *   2. Resolve hoisted deps (packages npm placed in the root node_modules) by reading
 *      openclaw's package.json, then recursively resolving transitive deps.
 *   3. Strip non-runtime files (typings, source maps, docs, tests) to reduce size.
 *
 * No network access needed — all packages are already installed locally.
 */

const fs = require('fs')
const path = require('path')

// Files and directories to skip during copy (not needed at runtime)
const SKIP_FILES = new Set([
  '.eslintrc', '.eslintrc.js', '.eslintrc.json', '.eslintrc.yml',
  '.prettierrc', '.prettierrc.js', '.prettierrc.json', '.prettierrc.yml',
  '.editorconfig', '.npmignore', '.gitattributes', '.gitignore',
  'tsconfig.json', 'tsconfig.build.json', 'tslint.json',
  '.DS_Store', 'Thumbs.db',
  'Makefile', 'Gruntfile.js', 'Gulpfile.js',
  '.travis.yml', '.gitlab-ci.yml', 'appveyor.yml',
  'jest.config.js', 'jest.config.ts', 'vitest.config.ts',
  '.eslintignore', '.prettierignore'
])

const SKIP_DIRS = new Set([
  'test', 'tests', '__tests__', 'spec',
  'docs', 'documentation',
  'examples', 'example', 'samples',
  '.github', '.vscode', '.idea',
  'coverage', '.nyc_output',
  'benchmark', 'benchmarks',
  'man', 'website',
  'fixtures', '__fixtures__', 'mocks', '__mocks__'
])

const SKIP_EXTENSIONS = new Set([
  '.d.ts', '.d.ts.map', '.d.cts', '.d.mts',
  '.js.map', '.mjs.map', '.cjs.map',
  '.css.map', '.ts.map'
])

/** Extensions considered documentation (safe to strip) vs runtime code */
const DOC_EXTENSIONS = new Set(['.md', '.txt', '.rst', '.html', '.htm', ''])

function isDocFile(lower, prefix) {
  if (lower === prefix) return true // No extension (e.g. "README")
  const afterPrefix = lower.slice(prefix.length)
  // Only skip if the extension is a doc extension (e.g. changelog.md, not changelog.js)
  return afterPrefix.startsWith('.') && DOC_EXTENSIONS.has(afterPrefix)
}

function shouldSkipFile(name) {
  if (SKIP_FILES.has(name)) return true
  const lower = name.toLowerCase()
  if (isDocFile(lower, 'readme')) return true
  if (isDocFile(lower, 'changelog')) return true
  if (isDocFile(lower, 'history')) return true
  if (isDocFile(lower, 'license')) return true
  if (isDocFile(lower, 'licence')) return true
  // Check compound extensions like .d.ts, .js.map
  for (const ext of SKIP_EXTENSIONS) {
    if (name.endsWith(ext)) return true
  }
  return false
}

function shouldSkipDir(name) {
  return SKIP_DIRS.has(name)
}

/** Recursively copy a directory, skipping non-runtime files */
function copyDirSync(src, dest) {
  if (!fs.existsSync(src)) return
  fs.mkdirSync(dest, { recursive: true })
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name)
    const destPath = path.join(dest, entry.name)
    if (entry.isDirectory()) {
      if (shouldSkipDir(entry.name)) continue
      copyDirSync(srcPath, destPath)
    } else {
      if (shouldSkipFile(entry.name)) continue
      fs.copyFileSync(srcPath, destPath)
    }
  }
}

/**
 * Recursively resolves and copies all dependencies for a package.
 * Tracks visited packages to avoid cycles and redundant work.
 */
function resolveDep(pkgName, searchPaths, destNM, visited) {
  if (visited.has(pkgName)) return
  visited.add(pkgName)

  // Already exists in destination (e.g. from nested copy)
  const destPkg = path.join(destNM, pkgName)
  if (fs.existsSync(destPkg)) {
    // Still need to check its transitive deps
    readAndResolveDeps(destPkg, searchPaths, destNM, visited)
    return
  }

  // Find the package in search paths
  let srcPkg = null
  for (const nm of searchPaths) {
    const candidate = path.join(nm, pkgName)
    if (fs.existsSync(candidate)) {
      srcPkg = candidate
      break
    }
  }

  if (!srcPkg) return // Optional dep or not installed — skip

  copyDirSync(srcPkg, destPkg)

  // Recursively resolve this package's dependencies
  readAndResolveDeps(srcPkg, searchPaths, destNM, visited)
}

/**
 * Reads a package's package.json and resolves its production dependencies.
 */
function readAndResolveDeps(pkgDir, searchPaths, destNM, visited) {
  const pkgJsonPath = path.join(pkgDir, 'package.json')
  if (!fs.existsSync(pkgJsonPath)) return

  try {
    const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf-8'))
    const deps = Object.keys(pkg.dependencies || {})
    for (const dep of deps) {
      resolveDep(dep, searchPaths, destNM, visited)
    }
  } catch {
    // Malformed package.json — skip
  }
}

/**
 * Second pass: walk all nested node_modules in the destination tree and
 * resolve any hoisted deps that are missing. This handles cases like
 * grammy/node_modules/node-fetch needing whatwg-url from root node_modules.
 */
function resolveNestedDeps(dir, searchPaths, topDestNM, visited) {
  if (!fs.existsSync(dir)) return
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const pkgDir = path.join(dir, entry.name)

    // Skip scoped package root dirs — descend into them
    if (entry.name.startsWith('@')) {
      resolveNestedDeps(pkgDir, searchPaths, topDestNM, visited)
      continue
    }

    // Read this package's deps
    const pkgJsonPath = path.join(pkgDir, 'package.json')
    if (!fs.existsSync(pkgJsonPath)) continue

    try {
      const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf-8'))
      const deps = Object.keys(pkg.dependencies || {})
      for (const dep of deps) {
        // Check if dep is resolvable from this package's perspective:
        // walk up from pkgDir looking for node_modules/dep
        if (!canResolveFrom(pkgDir, dep, topDestNM)) {
          // Copy to topDestNM so it's resolvable
          resolveDep(dep, searchPaths, topDestNM, visited)
        }
      }
    } catch {
      // skip
    }

    // Recurse into this package's own node_modules
    const nestedNM = path.join(pkgDir, 'node_modules')
    if (fs.existsSync(nestedNM)) {
      resolveNestedDeps(nestedNM, searchPaths, topDestNM, visited)
    }
  }
}

/**
 * Checks if a dependency can be resolved from a given directory by walking
 * up the tree looking for node_modules/dep (Node.js resolution algorithm).
 */
function canResolveFrom(fromDir, depName, stopAt) {
  let current = fromDir
  while (current.length >= stopAt.length) {
    const nmDir = path.join(current, 'node_modules', depName)
    if (fs.existsSync(nmDir)) return true
    const parent = path.dirname(current)
    if (parent === current) break
    current = parent
  }
  return false
}

/**
 * Recursively strips non-runtime files from an already-copied directory.
 * Used for directories copied before the skip logic was applied (extensions).
 */
function stripDir(dir) {
  if (!fs.existsSync(dir)) return
  let removed = 0
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (shouldSkipDir(entry.name)) {
        fs.rmSync(fullPath, { recursive: true, force: true })
        removed++
      } else {
        removed += stripDir(fullPath)
      }
    } else {
      if (shouldSkipFile(entry.name)) {
        fs.unlinkSync(fullPath)
        removed++
      }
    }
  }
  return removed
}

exports.default = async function afterPack(context) {
  const { appOutDir } = context
  const projectRoot = path.resolve(__dirname, '..')
  const srcOpenclaw = path.join(projectRoot, 'node_modules', 'openclaw')
  const destOpenclaw = path.join(appOutDir, 'resources', 'openclaw')

  if (!fs.existsSync(destOpenclaw)) {
    console.log('[fix-openclaw-deps] openclaw not in resources — skipping')
    return
  }

  const destNM = path.join(destOpenclaw, 'node_modules')

  // ── 1. Copy back nested node_modules stripped by electron-builder ──
  const srcNestedNM = path.join(srcOpenclaw, 'node_modules')
  if (fs.existsSync(srcNestedNM)) {
    console.log('[fix-openclaw-deps] Restoring openclaw/node_modules...')
    copyDirSync(srcNestedNM, destNM)
  }

  // ── 2. Resolve hoisted deps recursively ────────────────────────────
  // Search order: openclaw's own node_modules first, then project root
  const searchPaths = [
    path.join(srcOpenclaw, 'node_modules'),
    path.join(projectRoot, 'node_modules')
  ]

  const visited = new Set()

  const pkgJsonPath = path.join(srcOpenclaw, 'package.json')
  if (fs.existsSync(pkgJsonPath)) {
    const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf-8'))
    const deps = Object.keys(pkg.dependencies || {})

    console.log(`[fix-openclaw-deps] Resolving ${deps.length} dependencies (+ transitives)...`)
    for (const dep of deps) {
      resolveDep(dep, searchPaths, destNM, visited)
    }

    const totalCopied = fs.existsSync(destNM)
      ? fs.readdirSync(destNM).length
      : 0
    console.log(`[fix-openclaw-deps] ${totalCopied} packages in openclaw/node_modules (${visited.size} resolved)`)
  }

  // ── 3. Resolve deps of nested packages (e.g. grammy/node_modules/node-fetch → whatwg-url)
  if (fs.existsSync(destNM)) {
    const before = visited.size
    resolveNestedDeps(destNM, searchPaths, destNM, visited)
    const added = visited.size - before
    if (added > 0) {
      console.log(`[fix-openclaw-deps] Resolved ${added} additional nested dependencies`)
    }
  }

  // ── 4. Restore extensions node_modules ─────────────────────────────
  const srcExtDir = path.join(srcOpenclaw, 'extensions')
  const destExtDir = path.join(destOpenclaw, 'extensions')
  if (fs.existsSync(srcExtDir) && fs.existsSync(destExtDir)) {
    let extCount = 0
    for (const ext of fs.readdirSync(srcExtDir, { withFileTypes: true })) {
      if (!ext.isDirectory()) continue
      const extNM = path.join(srcExtDir, ext.name, 'node_modules')
      if (fs.existsSync(extNM)) {
        const destExtNM = path.join(destExtDir, ext.name, 'node_modules')
        if (!fs.existsSync(destExtNM)) {
          copyDirSync(extNM, destExtNM)
          extCount++
        }
      }
    }
    if (extCount > 0) {
      console.log(`[fix-openclaw-deps] Restored node_modules for ${extCount} extensions`)
    }
  }

  // ── 5. Ensure openclaw docs/reference/templates are present ─────────
  // electron-builder may partially exclude files; explicitly sync templates
  const srcTemplates = path.join(srcOpenclaw, 'docs', 'reference', 'templates')
  const destTemplates = path.join(destOpenclaw, 'docs', 'reference', 'templates')
  if (fs.existsSync(srcTemplates)) {
    fs.mkdirSync(destTemplates, { recursive: true })
    let synced = 0
    for (const f of fs.readdirSync(srcTemplates)) {
      const destFile = path.join(destTemplates, f)
      if (!fs.existsSync(destFile)) {
        fs.copyFileSync(path.join(srcTemplates, f), destFile)
        synced++
      }
    }
    if (synced > 0) console.log(`[fix-openclaw-deps] Synced ${synced} missing template files`)
  }

  // ── 7. Strip non-runtime files from node_modules ─────────────────────
  // NOTE: do NOT strip openclaw/docs — templates are runtime-critical
  const stripped = stripDir(destNM)
  console.log(`[fix-openclaw-deps] Stripped ${stripped} non-runtime files`)

  // ── 8. Pack node_modules into .7z archive (Windows only) ──────────────
  // Reduces NSIS installer file count from ~13K to 1, dramatically speeding
  // up installation. The NSIS customInstall macro extracts it during install.
  if (process.platform === 'win32') {
    const { execSync } = require('child_process')

    // 7za.exe is vendored by 7zip-bin (transitive dep of electron-builder)
    const path7za = path.join(projectRoot, 'node_modules', '7zip-bin', 'win', 'x64', '7za.exe')
    if (!fs.existsSync(path7za)) {
      console.warn('[fix-openclaw-deps] 7za.exe not found — skipping 7z packing (install will be slow)')
    } else {
      const archiveName = 'openclaw-deps.7z'
      const archivePath = path.join(destOpenclaw, archiveName)

      console.log('[fix-openclaw-deps] Packing openclaw/node_modules into 7z archive...')
      const startTime = Date.now()

      try {
        // -mx0 = store (no compression) — NSIS compresses the whole installer anyway
        // -mmt=on = multi-threaded file scanning
        // stdio: 'ignore' prevents pipe buffer deadlock (7za outputs per-file progress for 13K files)
        execSync(
          `"${path7za}" a -t7z -mx0 -mmt=on "${archiveName}" node_modules`,
          { cwd: destOpenclaw, stdio: 'ignore', timeout: 300_000 }
        )

        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)
        const archiveSize = (fs.statSync(archivePath).size / 1024 / 1024).toFixed(1)
        console.log(`[fix-openclaw-deps] Archive created: ${archiveSize}MB in ${elapsed}s`)

        // Copy 7za.exe so NSIS customInstall macro can use it during install
        fs.copyFileSync(path7za, path.join(destOpenclaw, '7za.exe'))

        // Remove the original node_modules — the archive replaces it
        fs.rmSync(destNM, { recursive: true, force: true })

        console.log('[fix-openclaw-deps] Replaced node_modules with 7z archive + 7za.exe')
      } catch (err) {
        console.error('[fix-openclaw-deps] 7z packing failed:', err.message)
        console.log('[fix-openclaw-deps] Falling back to individual files (install will be slow)')
        try { fs.unlinkSync(archivePath) } catch {}
      }
    }
  }

  console.log('[fix-openclaw-deps] Done')
}
