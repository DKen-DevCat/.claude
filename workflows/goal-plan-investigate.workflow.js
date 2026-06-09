export const meta = {
  name: 'goal-plan-investigate',
  description: '/goal:plan の調査フェーズ。goal実態と現状実態を並列fan-outで調べ、視点分散の多票クリティックで敵対的に抜けを洗い、構造化結果を返す（plan.mdの作文と判断はOpusが後段で行う）',
  phases: [
    { title: 'Investigate', detail: 'goal実態+現状実態を並列probe（sonnet/Explore/read-only/構造化）' },
    { title: 'Critic', detail: '視点分散の多票クリティック（coverage/grounding/risk）がseverity付きの抜けを提案しhigh gap収束を見る' },
  ],
}

// args: { goal, why, requirements, context, cwd }
// Workflowランタイムは args をJSON文字列で渡す場合があるため防御的にパースする
let a = args || {}
if (typeof a === 'string') {
  try { a = JSON.parse(a) } catch (e) { a = {} }
}
const goal = a.goal || '(goal未指定)'
const why = a.why || ''
const requirements = a.requirements || ''
const ctx = a.context || ''
const cwd = a.cwd || '.'

const SIDES = [
  {
    key: 'goal-reality',
    focus:
      `goal側の実態。goal「${goal}」を実現する対象の構成要素・繋がり・仕組み、` +
      `関連する既存実装/設定/慣行を、推測せず実コード・実ファイルで確認する。`,
  },
  {
    key: 'current-reality',
    focus:
      `現状側の実態。現在の関連コード/設定/構成の実態、goalとの接点、` +
      `既存の制約・依存・落とし穴を、実ファイルで確認する。`,
  },
]

const FINDING_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    side: { type: 'string', description: 'goal-reality | current-reality' },
    components: { type: 'array', items: { type: 'string' }, description: '構成要素' },
    connections: { type: 'array', items: { type: 'string' }, description: '繋がり・仕組み' },
    files: { type: 'array', items: { type: 'string' }, description: '該当ファイル(path:line可)' },
    insights: { type: 'array', items: { type: 'string' }, description: '気付き・注意点' },
    gaps: { type: 'array', items: { type: 'string' }, description: 'goal到達のために埋めるべき差分の素材' },
  },
  required: ['side', 'components', 'connections', 'files', 'insights', 'gaps'],
}

phase('Investigate')

// 予算に応じて観点あたりprobe数を可変（targetなしなら1）。silent capを避けlogで開示。
const perSide = budget && budget.total
  ? Math.max(1, Math.min(3, Math.floor(budget.total / 150000)))
  : 1
log(`probes/side = ${perSide} (budget total: ${budget && budget.total ? budget.total : 'none'})`)

const probes = []
for (const side of SIDES) {
  for (let i = 0; i < perSide; i++) {
    probes.push(() =>
      agent(
        `あなたは /goal:plan の調査担当です。read-only。推測禁止、必ず実ファイルを根拠にする。\n` +
        `作業ルート: ${cwd}\n` +
        `goal: ${goal}\nなぜ: ${why}\n要件: ${requirements}\n前提: ${ctx}\n\n` +
        `担当観点[${side.key} #${i + 1}]: ${side.focus}\n` +
        (perSide > 1
          ? `他の同観点担当と重複しないよう、まだ調べられていない領域を優先せよ。\n`
          : '') +
        `Read/Grep/Glob で実態を確認し、schemaに従って構造化して返せ。`,
        {
          label: `probe:${side.key}#${i + 1}`,
          phase: 'Investigate',
          model: 'sonnet',
          agentType: 'Explore',
          schema: FINDING_SCHEMA,
        }
      )
    )
  }
}
const findings = (await parallel(probes)).filter(Boolean)
log(`findings collected: ${findings.length}`)

phase('Critic')

// deep-research流の「視点分散×多票敵対検証」を完全性クリティックに移植。
// 単一criticではなく、観点を割った複数verifierが並列で severity 付きの抜けを敵対的に提案し、
// high severity gap が残らないことを収束シグナルとして扱う。十分性の確定は後段Opusが行う。
// plan.md が読む critic.{missingAngles,unverifiedClaims,suggestedFollowups} は
// 各レンズの集約として後方互換に保ちつつ、consensus 系メタを追加する。
const CRITIC_LENSES = [
  {
    key: 'coverage',
    focus:
      'goal到達に必要なのに調査されていない構成要素・依存・接点・慣行が無いか。' +
      'goal-reality / current-reality のどちらかに抜け領域が無いか。',
  },
  {
    key: 'grounding',
    focus:
      '各findingが実ファイル根拠を伴うか（filesが空・推測混入・未検証の主張が無いか）。' +
      '既存実装や自己申告を鵜呑みにした記述が無いか。',
  },
  {
    key: 'risk',
    focus:
      'plan段階で潰すべき落とし穴・前提崩れ・破壊的影響・見落とされた制約が無いか。' +
      'goalや要件に影響する未確定事項が伏在していないか。',
  },
]

const CRITIC_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    lens: { type: 'string' },
    missingAngles: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          angle: { type: 'string' },
          severity: { type: 'string', enum: ['low', 'medium', 'high'] },
        },
        required: ['angle', 'severity'],
      },
      description: '抜けている観点と severity',
    },
    unverifiedClaims: { type: 'array', items: { type: 'string' }, description: '未検証の主張' },
    suggestedFollowups: { type: 'array', items: { type: 'string' }, description: '追加で調べるべき点' },
    summary: { type: 'string' },
  },
  required: ['lens', 'missingAngles', 'unverifiedClaims', 'suggestedFollowups', 'summary'],
}

const uniq = (xs) => Array.from(new Set(xs))
const CRITIC_SEVERITIES = ['low', 'medium', 'high']
const CRITIC_SEVERITY_RANK = { low: 0, medium: 1, high: 2 }
const DEFAULT_MISSING_ANGLE_SEVERITY = 'medium'

const normalizeMissingAngleKey = (angle) => {
  if (typeof angle !== 'string') return ''

  return angle
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase()
    .replace(/[.,;:!?、。．，；：！？]+$/g, '')
    .trim()
}

const normalizeMissingAngle = (item) => {
  if (item && typeof item === 'object') {
    const angle = typeof item.angle === 'string' ? item.angle.trim() : ''
    const severity = CRITIC_SEVERITIES.includes(item.severity)
      ? item.severity
      : DEFAULT_MISSING_ANGLE_SEVERITY

    return angle ? { angle, severity } : null
  }

  if (typeof item === 'string') {
    const raw = item.trim()
    if (!raw) return null

    const prefixed = raw.match(/^\[(low|medium|high)\]\s*(.+)$/)
    if (prefixed) return { severity: prefixed[1], angle: prefixed[2].trim() }

    return { angle: raw, severity: DEFAULT_MISSING_ANGLE_SEVERITY }
  }

  return null
}

const normalizedMissingAngles = (critic) => {
  const items = critic && Array.isArray(critic.missingAngles) ? critic.missingAngles : []
  return items.map(normalizeMissingAngle).filter(Boolean)
}

const dedupeMissingAngles = (missingAngles) => {
  const byKey = new Map()

  for (const gap of missingAngles) {
    const normalized = normalizeMissingAngle(gap)
    if (!normalized) continue

    const key = normalizeMissingAngleKey(normalized.angle)
    if (!key) continue

    const existing = byKey.get(key)
    if (!existing) {
      byKey.set(key, { angle: normalized.angle, severity: normalized.severity })
      continue
    }

    if (CRITIC_SEVERITY_RANK[normalized.severity] > CRITIC_SEVERITY_RANK[existing.severity]) {
      existing.severity = normalized.severity
    }
  }

  return Array.from(byKey.values())
}

const formatMissingAngle = (gap) => `[${gap.severity}] ${gap.angle}`

const formatPromptList = (items) => {
  if (!Array.isArray(items) || !items.length) return '- (none)'
  return items.map((item) => `- ${item}`).join('\n')
}

const MAX_ROUNDS = 3
const STALLED_ROUNDS_LIMIT = 2
const MAX_FOLLOWUP_PROBES_PER_ROUND = 3
const MIN_ADDITIONAL_ROUND_BUDGET = 80000
log(
  `consensus loop config: maxRounds=${MAX_ROUNDS}, ` +
    `stalledRoundsLimit=${STALLED_ROUNDS_LIMIT}, ` +
    `maxFollowupProbes/round=${MAX_FOLLOWUP_PROBES_PER_ROUND}`
)

const budgetRemaining = () => {
  if (budget && typeof budget.remaining === 'function') return budget.remaining()

  if (budget && typeof budget.total === 'number' && typeof budget.spent === 'function') {
    return budget.total - budget.spent()
  }

  return null
}

const budgetStatus = () => {
  const remaining = budgetRemaining()
  if (remaining === Infinity) return 'remaining=Infinity'
  if (remaining === null) return 'remaining=null'
  return `remaining=${remaining}`
}

const budgetAllowsAdditionalRound = (probeCount) => {
  const remaining = budgetRemaining()
  if (remaining === null || remaining === Infinity) return true

  return remaining >= Math.max(
    MIN_ADDITIONAL_ROUND_BUDGET,
    (probeCount + CRITIC_LENSES.length) * 20000
  )
}

const missingAngleGroups = (missingAngles) => {
  if (!missingAngles.length) return []

  const groupCount = Math.min(MAX_FOLLOWUP_PROBES_PER_ROUND, missingAngles.length)
  const groups = []
  for (let i = 0; i < groupCount; i++) groups.push([])
  for (let i = 0; i < missingAngles.length; i++) groups[i % groupCount].push(missingAngles[i])
  return groups
}

const aggregateCritic = (critics) => {
  const gapsByLens = critics.map((critic) => dedupeMissingAngles(normalizedMissingAngles(critic)))
  const highGapsByLens = gapsByLens.map((gaps) => gaps.filter((gap) => gap.severity === 'high'))
  const missingAngles = dedupeMissingAngles(gapsByLens.flat())
  const unresolvedHighGaps = dedupeMissingAngles(highGapsByLens.flat()).map((gap) => gap.angle)
  const sufficientVotes = highGapsByLens.filter((gaps) => !gaps.length).length
  const consensusComplete = highGapsByLens.every((gaps) => gaps.length === 0)

  // plan.md が読む3配列は各レンズの集約として後方互換に保つ（意味的に重複排除）
  return {
    consensusComplete,
    sufficientVotes,
    totalLenses: CRITIC_LENSES.length,
    missingAngles: missingAngles.map(formatMissingAngle),
    unresolvedHighGaps,
    unverifiedClaims: uniq(critics.flatMap((c) => c.unverifiedClaims || [])),
    suggestedFollowups: uniq(critics.flatMap((c) => c.suggestedFollowups || [])),
    lenses: critics,
  }
}

const runCriticRound = async (roundNumber, findingsDelta, unresolvedHighGaps = []) => {
  log(`critic round ${roundNumber}: ${CRITIC_LENSES.length} adversarial lenses (multi-vote)`)
  const findingsContextLabel = roundNumber === 1
    ? '調査結果(JSON)'
    : '直前に新規追加された findings 差分(JSON)'
  const findingsContext = Array.isArray(findingsDelta) ? findingsDelta : []
  const settledGapCarry = roundNumber === 1
    ? ''
    : `現在未解決の high gap リスト:\n${formatPromptList(unresolvedHighGaps)}\n\n` +
      `このroundでは以下の未解決 high gap に新情報があるかだけを評価せよ。` +
      `既出の gap を別表現で再生成するな。` +
      `未解決のままなら上の文言をそのまま high として残し、解消されたものは再掲しない。\n\n`
  const missingAngleInstruction = roundNumber === 1
    ? `抜けは全て severity 付きで提案せよ（列挙は敵対的に厳しく）。`
    : `missingAngles は現在未解決の high gap についてのみ返せ。` +
      `low/medium の新規列挙や既出 gap の言い換えは出さない。`

  const critics = (await parallel(
    CRITIC_LENSES.map((L) => () =>
      agent(
        `あなたは /goal:plan 調査の完全性クリティックです。read-only。findingの自己申告を信じず、` +
          `必要なら実ファイルを確認して敵対的に粗を探す。\n` +
          `作業ルート: ${cwd}\n` +
          `goal: ${goal}\nなぜ: ${why}\n要件: ${requirements}\n前提: ${ctx}\n\n` +
          `担当レンズ[${L.key}]: ${L.focus}\n` +
          `他レンズと重複せず自分の観点に集中せよ。` +
          missingAngleInstruction +
          `high はこの抜けを埋めずに plan を書くと plan が誤る/危険になるものに限る。` +
          `十分かどうかは判定しない（それは人間が確定する）。\n\n` +
          settledGapCarry +
          `${findingsContextLabel}:\n${JSON.stringify(findingsContext, null, 2)}\n\n` +
          `schemaに従って構造化提案を返せ。`,
        { label: `critic:r${roundNumber}:${L.key}`, phase: 'Critic', model: 'sonnet', schema: CRITIC_SCHEMA }
      )
    )
  )).filter(Boolean)

  const aggregated = aggregateCritic(critics)
  log(
    `critic round ${roundNumber} consensus: ` +
      `${aggregated.consensusComplete ? 'complete' : 'INCOMPLETE'} ` +
      `(${aggregated.sufficientVotes}/${CRITIC_LENSES.length} lenses without high gaps, ` +
      `highGaps=${aggregated.unresolvedHighGaps.length}, ` +
      `missingAngles=${aggregated.missingAngles.length})`
  )
  return aggregated
}

let newFindingsThisRound = findings.slice()
let critic = await runCriticRound(1, newFindingsThisRound)
log(
  `consensus round 1: initial probes=${probes.length}, ` +
    `findings=${findings.length}, consensus=${critic.consensusComplete ? 'complete' : 'INCOMPLETE'}`
)
const rounds = [
  {
    round: 1,
    probeCount: probes.length,
    newFindings: findings.length,
    findingCount: findings.length,
    consensusComplete: critic.consensusComplete,
    sufficientVotes: critic.sufficientVotes,
    missingAngles: critic.missingAngles.length,
    unresolvedHighGaps: critic.unresolvedHighGaps.length,
  },
]

let roundNumber = 1
let stalledRounds = 0

while (!critic.consensusComplete && roundNumber < MAX_ROUNDS) {
  const nextRound = roundNumber + 1
  const previousHighGapCount = critic.unresolvedHighGaps.length
  const unresolvedHighGaps = critic.unresolvedHighGaps
  const previousRoundNewFindings = newFindingsThisRound.slice()
  const groups = missingAngleGroups(unresolvedHighGaps)

  log(
    `consensus round ${nextRound}: ` +
      `highGaps=${critic.unresolvedHighGaps.length}, ` +
      `missingAngles=${critic.missingAngles.length}, ` +
      `followup probes=${groups.length}/${MAX_FOLLOWUP_PROBES_PER_ROUND}, ` +
      `budget ${budgetStatus()}`
  )

  if (!budgetAllowsAdditionalRound(groups.length)) {
    log(`consensus loop stopped before round ${nextRound}: budget backstop (${budgetStatus()})`)
    break
  }

  phase('Investigate')

  const beforeFindingCount = findings.length
  const followupFindings = groups.length
    ? (await parallel(
        groups.map((angles, index) => () =>
          agent(
            `あなたは /goal:plan の追加調査担当です。read-only。推測禁止、必ず実ファイルを根拠にする。\n` +
              `作業ルート: ${cwd}\n` +
              `goal: ${goal}\nなぜ: ${why}\n要件: ${requirements}\n前提: ${ctx}\n\n` +
              `直前criticで high severity と提案された missingAngles を再probeする。` +
              `low/medium は収束を妨げないため、このroundでは high を優先する。\n` +
              `現在未解決の high gap リスト:\n${formatPromptList(unresolvedHighGaps)}\n\n` +
              `既存findingsは直前roundで新規追加された差分のみを参照する。` +
              `累積findings全体は再注入されないため、以下の差分と未解決 high gap だけを根拠に追加調査する。\n` +
              `担当highSeverityMissingAngles[round ${nextRound} #${index + 1}]:\n` +
              `${angles.map((angle) => `- ${angle}`).join('\n')}\n\n` +
              `直前roundで新規追加された findings 差分(JSON):\n` +
              `${JSON.stringify(previousRoundNewFindings, null, 2)}\n\n` +
              `side は主対象に応じて goal-reality または current-reality を選ぶ。` +
              `Read/Grep/Glob で実態を確認し、schemaに従って構造化して返せ。`,
            {
              label: `probe:followup:r${nextRound}#${index + 1}`,
              phase: 'Investigate',
              model: 'sonnet',
              agentType: 'Explore',
              schema: FINDING_SCHEMA,
            }
          )
        )
      )).filter(Boolean)
    : []

  for (const finding of followupFindings) findings.push(finding)
  newFindingsThisRound = followupFindings

  const newFindings = findings.length - beforeFindingCount
  log(`consensus round ${nextRound}: findings added=${newFindings}, total findings=${findings.length}`)

  phase('Critic')
  critic = await runCriticRound(nextRound, newFindingsThisRound, unresolvedHighGaps)

  const highGapsShrank = critic.unresolvedHighGaps.length < previousHighGapCount
  const madeProgress = newFindings > 0 && highGapsShrank
  stalledRounds = madeProgress ? 0 : stalledRounds + 1
  roundNumber = nextRound

  rounds.push({
    round: roundNumber,
    probeCount: groups.length,
    newFindings,
    findingCount: findings.length,
    consensusComplete: critic.consensusComplete,
    sufficientVotes: critic.sufficientVotes,
    missingAngles: critic.missingAngles.length,
    unresolvedHighGaps: critic.unresolvedHighGaps.length,
    stalledRounds,
  })

  log(
    `consensus round ${roundNumber}: ` +
      `progress=${madeProgress ? 'yes' : 'no'} ` +
      `(newFindings=${newFindings}, highGaps ${previousHighGapCount}->${critic.unresolvedHighGaps.length}, ` +
      `missingAngles=${critic.missingAngles.length}), ` +
      `stalled=${stalledRounds}/${STALLED_ROUNDS_LIMIT}`
  )

  if (critic.consensusComplete) {
    log(`consensus loop stopped after round ${roundNumber}: consensus complete`)
    break
  }

  if (stalledRounds >= STALLED_ROUNDS_LIMIT) {
    log(`consensus loop stopped after round ${roundNumber}: no progress for ${stalledRounds} consecutive rounds`)
    break
  }
}

if (!critic.consensusComplete && roundNumber >= MAX_ROUNDS) {
  log(`consensus loop stopped after round ${roundNumber}: max rounds ${MAX_ROUNDS} reached`)
}

if (critic.unresolvedHighGaps.length) {
  log(`consensus loop exiting with unresolved high gaps: ${critic.unresolvedHighGaps.length} (escalating)`)
}

critic.rounds = rounds
critic.maxRounds = MAX_ROUNDS
critic.stalledRounds = stalledRounds
critic.stallLimit = STALLED_ROUNDS_LIMIT

return { goal, why, requirements, context: ctx, findings, critic }
