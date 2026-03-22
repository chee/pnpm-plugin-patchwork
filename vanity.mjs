import { isMainThread, Worker, workerData, parentPort } from "node:worker_threads"
import { availableParallelism } from "node:os"

const DOC_ID_LEN = 28
const BASE58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"
const BASE58_CHARS = new Set(BASE58)
const BASE58_CHARS_LOWER = new Set(BASE58.toLowerCase())

function validatePattern(arg, caseSensitive, regexMode) {
	const regexMatch = arg.match(/^\/(.+)\/$/)
	const isRegex = regexMatch || regexMode
	// extract the literal characters from the pattern
	const raw = regexMatch ? regexMatch[1] : arg
	const str = isRegex ? raw.replace(/[\\^$.*+?()[\]{}|]/g, "") : raw
	if (!str) return
	const charSet = caseSensitive ? BASE58_CHARS : BASE58_CHARS_LOWER
	for (const c of str) {
		const check = caseSensitive ? c : c.toLowerCase()
		if (!charSet.has(check)) {
			console.error(
				`Error: '${c}' is not in the base58 alphabet (${BASE58})`
			)
			console.error(`DocumentIds can never contain '${c}', so this search would run forever.`)
			process.exit(1)
		}
	}
}

function parsePattern(arg, caseSensitive, regexMode) {
	const regexMatch = arg.match(/^\/(.+)\/$/)
	if (regexMatch || regexMode) {
		const source = regexMatch ? regexMatch[1] : arg
		const flags = caseSensitive ? "" : "i"
		return { type: "regex", regex: new RegExp(source, flags), source: arg }
	}
	return { type: "string", value: arg, source: arg }
}

function matchPattern(id, pattern) {
	if (pattern.type === "regex") {
		return pattern.regex.test(id)
	}
	return pattern.caseSensitive
		? id.includes(pattern.value)
		: id.toLowerCase().includes(pattern.value.toLowerCase())
}

function estimateAttempts(patterns) {
	if (patterns.some(p => p.type === "regex")) return null
	let totalP = 1
	let usedChars = 0
	for (const p of patterns) {
		const t = p.value
		const positions = DOC_ID_LEN - usedChars - t.length + 1
		if (positions <= 0) return Infinity
		let charP
		if (p.caseSensitive) {
			charP = Math.pow(1 / 58, t.length)
		} else {
			const missing = new Set(["I", "O", "l"])
			let prob = 1
			for (const c of t) {
				const lower = c.toLowerCase()
				const upper = c.toUpperCase()
				const variants = [lower, upper].filter(
					v => v !== lower || v !== upper ? !missing.has(v) : true
				)
				prob *= variants.length / 58
			}
			charP = prob
		}
		const substringP = 1 - Math.pow(1 - charP, positions)
		totalP *= substringP
		usedChars += t.length
	}
	return Math.round(1 / totalP)
}

function formatDuration(seconds) {
	if (seconds < 60) return `${seconds.toFixed(0)}s`
	if (seconds < 3600) return `${(seconds / 60).toFixed(1)} minutes`
	if (seconds < 86400) return `${(seconds / 3600).toFixed(1)} hours`
	return `${(seconds / 86400).toFixed(1)} days`
}

if (!isMainThread) {
	const { serializedPatterns } = workerData
	const { generateAutomergeUrl, parseAutomergeUrl } = await import(
		"@automerge/automerge-repo"
	)

	// reconstruct patterns (RegExp doesn't survive structured clone)
	const patterns = serializedPatterns.map(p =>
		p.type === "regex"
			? { type: "regex", regex: new RegExp(p.regexSource, p.regexFlags) }
			: p
	)

	let attempts = 0
	while (true) {
		const { documentId } = parseAutomergeUrl(generateAutomergeUrl())
		attempts++

		if (patterns.every(p => matchPattern(documentId, p))) {
			parentPort.postMessage({ type: "found", documentId, attempts })
			break
		}

		if (attempts % 1_000_000 === 0) {
			parentPort.postMessage({ type: "progress", attempts })
		}
	}
} else {
	const args = process.argv.slice(2)
	const caseInsensitive = args.includes("--case-insensitive") || args.includes("-i")
	const caseSensitive = !caseInsensitive
	const regexMode = args.includes("--regex") || args.includes("-r")
	const targetArgs = args.filter(a => !a.startsWith("--") && a !== "-i" && a !== "-r")

	if (targetArgs.length === 0) {
		console.log("Usage: node vanity.mjs [--case-sensitive] <pattern1> [pattern2] ...")
		console.log("")
		console.log("Patterns can be plain strings or /regex/:")
		console.log("  node vanity.mjs chee mimi            # case-sensitive")
		console.log("  node vanity.mjs -i chee mimi          # case-insensitive")
		console.log("  node vanity.mjs '/^chee/' mimi         # regex (quote for shell!)")
		console.log("  node vanity.mjs -i '/chee.*mimi/'")
		console.log("  node vanity.mjs -r '^chee' 'mimi$'     # treat all args as regex")
		process.exit(1)
	}

	targetArgs.forEach(arg => validatePattern(arg, caseSensitive, regexMode))
	const patterns = targetArgs.map(arg => {
		const p = parsePattern(arg, caseSensitive, regexMode)
		if (p.type === "string") p.caseSensitive = caseSensitive
		return p
	})

	// serialize for worker threads (RegExp can't be cloned)
	const serializedPatterns = patterns.map(p =>
		p.type === "regex"
			? { type: "regex", regexSource: p.regex.source, regexFlags: p.regex.flags }
			: p
	)

	const numWorkers = availableParallelism()
	const mode = caseSensitive ? "case-sensitive" : "case-insensitive"
	const patternDescs = patterns.map(p => p.source).join(" AND ")
	console.log(`Searching for DocumentId matching: ${patternDescs} (${mode})`)
	console.log(`Using ${numWorkers} worker threads`)

	const estimatedAttempts = estimateAttempts(patterns)
	if (estimatedAttempts == null) {
		console.log("Estimated: unknown (regex patterns)")
	} else if (estimatedAttempts === Infinity) {
		console.log("Estimated: unlikely to ever find a match")
	} else {
		const estimatedRate = 950_000
		const estimatedSeconds = estimatedAttempts / estimatedRate
		console.log(`Estimated: ~${estimatedAttempts.toLocaleString()} attempts, ~${formatDuration(estimatedSeconds)}`)
	}
	console.log()

	const startTime = Date.now()
	let totalAttempts = 0
	const workers = []

	for (let i = 0; i < numWorkers; i++) {
		const worker = new Worker(new URL(import.meta.url), {
			workerData: { serializedPatterns },
		})
		workers.push(worker)

		worker.on("message", msg => {
			if (msg.type === "progress") {
				totalAttempts += 1_000_000
				if (totalAttempts % 50_000_000 === 0) {
					const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)
					const rate = (
						totalAttempts /
						((Date.now() - startTime) / 1000)
					).toFixed(0)
					console.log(
						`  ${(totalAttempts / 1_000_000).toFixed(0)}M attempts (${elapsed}s, ${rate}/s)...`
					)
				}
			} else if (msg.type === "found") {
				const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)
				console.log(`\nFound! (${elapsed}s, ~${totalAttempts.toLocaleString()}+ attempts)`)
				console.log(`DocumentId: ${msg.documentId}`)
				console.log(`AutomergeUrl: automerge:${msg.documentId}`)
				console.log()
				console.log("Paste in devtools (where `repo` and `Automerge` are defined):")
				console.log(`  const handle = repo.import(Automerge.save(Automerge.emptyChange(Automerge.init())), { docId: "${msg.documentId}" })`)
				console.log(`  handle.doneLoading()`)
				for (const w of workers) w.terminate()
				process.exit(0)
			}
		})
	}
}
