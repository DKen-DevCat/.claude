export const meta = {
  name: 'goal-exec-verify',
  description: '/goal:exec の検証フェーズ。codex実行済みタスクを、視点を割った複数verifierがplan設計と実ファイル/diffで逆検証し、verdictを返す（最終採否判定はOpusが行う）',
  phases: [
    { title: 'Verify', detail: '視点分散verifier（設計一致/副作用/完了条件）がread-onlyで判定' },
  ],
}

// args: { taskId, targets:[paths], planExcerpt, diffText, codexSummary, cwd, baseCommit }
// Workflowランタイムは args をJSON文字列で渡す場合があるため防御的にパースする
let a = args || {}
if (typeof a === 'string') {
  try { a = JSON.parse(a) } catch (e) { a = {} }
}
const taskId = a.taskId || 'task'
const targets = Array.isArray(a.targets) ? a.targets : []
const planExcerpt = a.planExcerpt || ''
const diffText = a.diffText || '(diff未提供。対象ファイルと plan 設計の整合のみ見よ。pre-existing/未コミット差分を副作用と見なすな)'
const codexSummary = a.codexSummary || ''
const cwd = a.cwd || '.'
const baseCommit = a.baseCommit || ''
const lockdown =
  'あなたは git を自前実行してはならない（git diff/status/log/show/--name-only を自分で叩くな）。' +
  '当該 task の差分の根拠は、上で渡された diffText のみ。自分で baseline を選ぶな。' +
  'diffText に含まれない変更を副作用と判定するな。' +
  'pre-existing/未コミット差分（タスク前から存在する変更）は当該 task の副作用ではない。'
const baselineNote = baseCommit
  ? `当該 task の baseline は baseCommit=${baseCommit}。diffText は git diff baseCommit..HEAD のスコープ済み差分であり、これが当該 task の真の差分である。`
  : ''

const LENSES = [
  {
    key: 'design-match',
    focus:
      'plan.mdの設計（操作対象/操作内容/影響場所と効果/goalへの影響）と、' +
      '実ファイル・diffが一致しているか。設計どおりに変更されたか。',
  },
  {
    key: 'side-effects',
    focus:
      'planに無い副作用・巻き込み変更・想定外の差分が無いか。' +
      '保存対象や無関係ファイルが変わっていないか。' +
      'pre-existing/未コミット差分は副作用ではない。diffText に現れた変更のみを評価対象とせよ。',
  },
  {
    key: 'completion',
    focus:
      'タスクの完了条件を実態が満たしているか。' +
      '必要物の存在・不要物の消失・構文/整合の健全性。',
  },
]

const VERDICT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    lens: { type: 'string' },
    matches: { type: 'boolean', description: 'plan設計と実態が一致しているか' },
    deviations: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          location: { type: 'string' },
          evidence: { type: 'string' },
          severity: { type: 'string', enum: ['low', 'medium', 'high'] },
        },
        required: ['location', 'evidence', 'severity'],
      },
    },
    summary: { type: 'string' },
  },
  required: ['lens', 'matches', 'deviations', 'summary'],
}

phase('Verify')
log(`verify ${taskId}: ${LENSES.length} lenses, targets: ${targets.join(', ') || '(none)'}`)

const verdicts = (await parallel(
  LENSES.map((L) => () =>
    agent(
      `あなたは /goal:exec の検証担当です。read-only。codexの自己申告を信じず、実ファイルとdiffで判定する。\n` +
        `作業ルート: ${cwd}\n対象ファイル: ${targets.join(', ') || '(指定なし)'}\n\n` +
        `${lockdown}\n` +
        `${baselineNote ? `${baselineNote}\n` : ''}\n` +
        `plan設計(抜粋):\n${planExcerpt}\n\n` +
        `git diff:\n${diffText}\n\n` +
        `codex報告(参考のみ):\n${codexSummary}\n\n` +
        `担当レンズ[${L.key}]: ${L.focus}\n` +
        `対象ファイルを Read し、上のdiffと突き合わせ、schemaに従って構造化判定を返せ。`,
      { label: `verify:${taskId}:${L.key}`, phase: 'Verify', model: 'sonnet', schema: VERDICT_SCHEMA }
    )
  )
)).filter(Boolean)

const matchVotes = verdicts.filter((v) => v.matches).length
const consensusMatch = matchVotes >= Math.ceil(LENSES.length / 2)
const highSeverity = verdicts.flatMap((v) => v.deviations || []).filter((d) => d.severity === 'high')

return { taskId, total: LENSES.length, matchVotes, consensusMatch, highSeverity, verdicts }
