export const meta = {
  name: 'goal-plan-investigate',
  description: '/goal:plan の調査フェーズ。goal実態と現状実態を並列fan-outで調べ、視点分散の多票クリティックで敵対的に抜けを洗い、構造化結果を返す（plan.mdの作文と判断はOpusが後段で行う）',
  phases: [
    { title: 'Investigate', detail: 'goal実態+現状実態を並列probe（sonnet/Explore/read-only/構造化）' },
    { title: 'Critic', detail: '視点分散の多票クリティック（coverage/grounding/risk）が敵対的に抜けを洗い多数決' },
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
// 単一criticではなく、観点を割った複数verifierが並列で「計画作文に十分か」を敵対的に判定し、
// 過半数で consensus を取る（goal-exec-verify と同型）。
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
    sufficient: { type: 'boolean', description: 'このレンズ観点で調査が計画作文に十分か' },
    missingAngles: { type: 'array', items: { type: 'string' }, description: '抜けている観点' },
    unverifiedClaims: { type: 'array', items: { type: 'string' }, description: '未検証の主張' },
    suggestedFollowups: { type: 'array', items: { type: 'string' }, description: '追加で調べるべき点' },
    summary: { type: 'string' },
  },
  required: ['lens', 'sufficient', 'missingAngles', 'unverifiedClaims', 'suggestedFollowups', 'summary'],
}

log(`critic: ${CRITIC_LENSES.length} adversarial lenses (multi-vote)`)

const critics = (await parallel(
  CRITIC_LENSES.map((L) => () =>
    agent(
      `あなたは /goal:plan 調査の完全性クリティックです。read-only。findingの自己申告を信じず、` +
        `必要なら実ファイルを確認して敵対的に粗を探す。\n` +
        `作業ルート: ${cwd}\n` +
        `goal: ${goal}\nなぜ: ${why}\n要件: ${requirements}\n前提: ${ctx}\n\n` +
        `担当レンズ[${L.key}]: ${L.focus}\n` +
        `他レンズと重複せず自分の観点に集中せよ。判断はデフォルトで「不十分」寄りに倒す。\n\n` +
        `調査結果(JSON):\n${JSON.stringify(findings, null, 2)}\n\n` +
        `schemaに従って構造化判定を返せ。`,
      { label: `critic:${L.key}`, phase: 'Critic', model: 'sonnet', schema: CRITIC_SCHEMA }
    )
  )
)).filter(Boolean)

// 過半数が「十分」と見なせば consensus 成立（goal-exec-verify と同じ多数決）
const sufficientVotes = critics.filter((c) => c.sufficient).length
const consensusComplete = sufficientVotes >= Math.ceil(CRITIC_LENSES.length / 2)

// plan.md が読む3配列は各レンズの集約として後方互換に保つ（文字列レベルで重複排除）
const uniq = (xs) => Array.from(new Set(xs))
const critic = {
  consensusComplete,
  sufficientVotes,
  totalLenses: CRITIC_LENSES.length,
  missingAngles: uniq(critics.flatMap((c) => c.missingAngles || [])),
  unverifiedClaims: uniq(critics.flatMap((c) => c.unverifiedClaims || [])),
  suggestedFollowups: uniq(critics.flatMap((c) => c.suggestedFollowups || [])),
  lenses: critics,
}
log(`critic consensus: ${consensusComplete ? 'complete' : 'INCOMPLETE'} (${sufficientVotes}/${CRITIC_LENSES.length} sufficient)`)

return { goal, why, requirements, context: ctx, findings, critic }
