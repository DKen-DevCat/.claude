export const meta = {
  name: 'goal-plan-investigate',
  description: '/goal:plan の調査フェーズ。goal実態と現状実態を並列fan-outで調べ、完全性クリティックで抜けを洗い、構造化結果を返す（plan.mdの作文と判断はOpusが後段で行う）',
  phases: [
    { title: 'Investigate', detail: 'goal実態+現状実態を並列probe（sonnet/Explore/read-only/構造化）' },
    { title: 'Critic', detail: '完全性クリティックが抜け観点・未検証主張を洗う' },
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

const CRITIC_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    missingAngles: { type: 'array', items: { type: 'string' }, description: '抜けている観点' },
    unverifiedClaims: { type: 'array', items: { type: 'string' }, description: '未検証の主張' },
    suggestedFollowups: { type: 'array', items: { type: 'string' }, description: '追加で調べるべき点' },
  },
  required: ['missingAngles', 'unverifiedClaims', 'suggestedFollowups'],
}

const critic = await agent(
  `あなたは調査の完全性クリティックです。以下の調査結果を読み、` +
    `抜けている観点・未検証の主張・追加で調べるべき点を挙げよ。実ファイル確認も可。\n\n` +
    `goal: ${goal}\n\n調査結果(JSON):\n${JSON.stringify(findings, null, 2)}`,
  { label: 'completeness-critic', phase: 'Critic', model: 'sonnet', schema: CRITIC_SCHEMA }
)

return { goal, why, requirements, context: ctx, findings, critic }
