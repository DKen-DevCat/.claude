export const meta = {
  name: 'deep-review-engine',
  description:
    'レビュー本体。変更差分を観点別lensで並列レビューし（ドメイン知識を注入）、各指摘を視点分散の多票verifierが敵対的にrefuteして偽陽性を落とし、severity+confidence付きの確定指摘と採否材料を返す。最終採否判定はorchestrator（セッションモデル）が行う。',
  phases: [
    {
      title: 'Review',
      detail:
        '観点別lens（domain-invariants/spec/correctness/security/data-model/api/perf/tests/maintainability）が差分＋ドメイン文脈をread-onlyで並列レビュー（sonnet, confidence≥80）',
    },
    {
      title: 'Verify',
      detail: '各指摘を視点分散の多票verifier（reproduce/grounding/domain）が敵対的にrefute、majority生存のみ採用',
    },
  ],
}

// ---- inputs（args は JSON 文字列で来ることがあるため防御的に parse する）----
let input = args
if (typeof input === 'string') {
  try {
    input = JSON.parse(input)
  } catch (_) {
    input = {}
  }
}
input = input || {}
const target = input.target || 'local diff'
const diffText = input.diffText || ''
const changedFiles = Array.isArray(input.changedFiles) ? input.changedFiles : []
const baseCommit = input.baseCommit || ''
const domainSources = Array.isArray(input.domainSources) ? input.domainSources : []
const cwd = input.cwd || ''
const localFilesMatch = input.localFilesMatch !== false // --pr 未 checkout 時のみ false
const effort = String(input.effort || 'high').toLowerCase()

// ---- 深度パラメータ（effort 勾配）----
const VERIFY_VOTES = effort === 'low' ? 1 : effort === 'medium' ? 2 : 3
const MAX_ROUNDS = effort === 'max' || effort === 'xhigh' ? 3 : effort === 'high' ? 2 : 1
const CONFIDENCE_GATE = 80

// パスモード（diff 無し・サブシステム全体レビュー）判定。diffText が空で変更ファイルだけ渡る。
const isPathMode = !diffText && changedFiles.length > 0

// 巨大 diff の上限ガード。全エージェントへ複製されるため一度だけ切り詰め、省略を明示する。
const DIFF_LIMIT = 200000
const diffTruncated = diffText.length > DIFF_LIMIT
const diffForPrompt = diffTruncated
  ? `${diffText.slice(0, DIFF_LIMIT)}\n... [diff truncated: ${diffText.length - DIFF_LIMIT} chars omitted]`
  : diffText
if (diffTruncated) {
  log(`警告: diff が ${diffText.length} 文字と大きいため ${DIFF_LIMIT} 文字で切り詰めた。末尾はレビュー対象外になる。`)
}

// diff スコープ句はモードで切り替える（パスモードでは diff 制約を外し全体レビュー）。
const scopeClause = isPathMode
  ? 'レビュー対象は「変更ファイル」一覧のファイル全体。Read して全体をレビューする（diff スコープ制約は適用しない）。'
  : 'レビュー対象は渡された diff の変更のみ。diff が触れていない既存コードは「文脈」であって指摘対象にしない（既存の落ち度を新規指摘に混ぜない）。'

// ---- 共通ガードレール（read-only・実ファイル根拠・スコープ固定）----
const LOCKDOWN = [
  'read-only。ファイルを編集・実行・commit しない。',
  '自己申告や推測を信じない。すべての指摘は実ファイル（path:line）を根拠にする。',
  scopeClause,
  'confidence 0-100 で採点し、80 未満は報告しない（ノイズ削減・偽陽性抑制）。',
].join(' ')

const localNote = isPathMode
  ? '変更ファイル一覧のファイルを Read して全体をレビューする（差分は無い）。'
  : localFilesMatch
    ? '対象ファイルを Read し、diff と突き合わせて根拠を確認する。'
    : '注意: 対象ブランチはローカル checkout されていない可能性がある。ローカルファイルが diff の head と一致しない場合は diff 本文を一次根拠にする。'

// プロンプトの差分セクション（パスモードでは差分ブロックを出さない）。
const diffSection = isPathMode
  ? '## レビュー対象\n差分なし。上記「変更ファイル」の全体をレビューする。'
  : `## 差分\n\`\`\`diff\n${diffForPrompt}\n\`\`\``

const domainNote = domainSources.length
  ? `ドメイン知識源（必要に応じて Read で読み、ドメイン/仕様の指摘の根拠にする）:\n${domainSources
      .map((p) => `- ${p}`)
      .join('\n')}`
  : 'ドメイン知識源は未指定。CLAUDE.md / docs / .claude/design / .claude/rules を自分で Glob/Grep して探し、あれば根拠にする。'

// ---- 同梱 lens（枠）。中身（ドメイン知識）は domainSources から実行時注入 ----
const LENSES = [
  {
    key: 'domain-invariants',
    focus:
      'ドメイン不変条件・業務ルールの違反。エンティティ間の整合、状態遷移、権限/課金/在庫/数量などの業務制約が壊れていないか。ドメイン文書に照らして判断する。',
  },
  {
    key: 'spec-consistency',
    focus:
      '仕様・設計ドキュメント（design/plan/ADR/tasks）との整合。実装が仕様の意図とズレていないか、仕様に無い挙動を勝手に足していないか、承認済み設計から逸脱していないか。',
  },
  {
    key: 'correctness',
    focus: '論理バグ・null/undefined 扱い・境界条件・レース条件・例外/エラー処理・型の誤り。実際に踏むバグかを重視する。',
  },
  {
    key: 'security',
    focus: '脆弱性。認可/認証、入力検証、インジェクション、機密の露出、安全でないデフォルト、権限昇格、SSRF/パストラバーサル等。',
  },
  {
    key: 'data-model',
    focus: 'スキーマ・データモデル・マイグレーション整合。破壊的変更、後方非互換、NULL/一意制約、インデックス、参照整合性、データ損失リスク。',
  },
  {
    key: 'api-contract',
    focus: 'API/インターフェース契約と後方互換。シグネチャ変更、レスポンス形状、破壊的変更、バージョニング、呼び出し側との齟齬。',
  },
  {
    key: 'performance',
    focus: '性能劣化。N+1、不要な再計算/再レンダ、無駄な I/O・ネットワーク、計算量、メモリリーク、同期ブロッキング。',
  },
  {
    key: 'tests',
    focus: 'テスト網羅と TDD。新規挙動に対するテスト有無、回帰リスク、脆い/無意味なテスト、カバレッジの穴、Red→Green の欠落。',
  },
  {
    key: 'maintainability',
    focus: '保守性。重複、過剰な複雑さ、責務越境、命名、altitude（抽象度）不一致、既存関数の再利用漏れ、簡素化余地。',
  },
]

const FINDING_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['lens', 'findings', 'summary'],
  properties: {
    lens: { type: 'string' },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'file', 'severity', 'confidence', 'category', 'evidence', 'suggestion'],
        properties: {
          title: { type: 'string' },
          file: { type: 'string', description: 'path:line 形式' },
          severity: { type: 'string', enum: ['low', 'medium', 'high', 'critical'] },
          confidence: { type: 'number', description: '0-100' },
          category: { type: 'string' },
          evidence: { type: 'string', description: '実ファイル/差分の該当箇所を引用した根拠' },
          suggestion: { type: 'string', description: '具体的な改善提案' },
        },
      },
    },
    summary: { type: 'string' },
  },
}

const VERDICT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['refuted', 'reason'],
  properties: {
    refuted: { type: 'boolean' },
    reason: { type: 'string' },
    adjustedSeverity: { type: 'string', enum: ['low', 'medium', 'high', 'critical'] },
  },
}

const SEVERITY_RANK = { low: 1, medium: 2, high: 3, critical: 4 }

function normalizeKey(f) {
  const file = String(f.file || '').trim().toLowerCase()
  const title = String(f.title || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[.。!！?？、，,]+$/, '')
  return `${file}::${title}`
}

// severity → confidence の順で強い方を残し、lens をマージする severity-aware dedup
function dedupe(findings) {
  const byKey = new Map()
  for (const f of findings) {
    const k = normalizeKey(f)
    const prev = byKey.get(k)
    if (!prev) {
      byKey.set(k, { ...f, lenses: Array.from(new Set(f.lenses || [f.lens].filter(Boolean))) })
      continue
    }
    const fRank = SEVERITY_RANK[f.severity] || 0
    const pRank = SEVERITY_RANK[prev.severity] || 0
    const fStronger = fRank > pRank || (fRank === pRank && (f.confidence || 0) > (prev.confidence || 0))
    const keep = fStronger ? { ...f } : { ...prev }
    keep.lenses = Array.from(
      new Set([...(prev.lenses || [prev.lens]), ...(f.lenses || [f.lens])].filter(Boolean)),
    )
    byKey.set(k, keep)
  }
  return Array.from(byKey.values())
}

// ---- メインループ（loop-until-dry を effort で有界化）----
const confirmedAll = []
const seen = new Set()
const roundStats = []
let round = 0

while (round < MAX_ROUNDS) {
  round += 1

  phase('Review')
  const priorNote =
    round > 1 && confirmedAll.length
      ? `既に確定済みの指摘（重複を避け、これらとは別の新規問題だけを探す）:\n${confirmedAll
          .map((f) => `- [${f.severity}] ${f.file} ${f.title}`)
          .join('\n')}`
      : ''

  const lensResults = await parallel(
    LENSES.map((lens) => () =>
      agent(
        [
          `あなたはシニアなコードレビュアー。lens=「${lens.key}」の観点だけに集中してレビューする。`,
          LOCKDOWN,
          localNote,
          domainNote,
          priorNote,
          `## 観点\n${lens.focus}`,
          `## レビュー対象: ${target}${baseCommit ? `（base ${baseCommit}）` : ''}`,
          changedFiles.length ? `## 変更ファイル\n${changedFiles.join('\n')}` : '',
          diffSection,
          'confidence≥80 の指摘のみ返す。該当が無ければ findings は空配列にする。各指摘には file(path:line)・severity・confidence・evidence(実引用)・具体的な suggestion を必ず付ける。',
        ]
          .filter(Boolean)
          .join('\n\n'),
        {
          label: `review:${lens.key}`,
          phase: 'Review',
          model: 'sonnet',
          agentType: 'Explore',
          schema: FINDING_SCHEMA,
        },
      ).then((r) => ({ lens: lens.key, r })),
    ),
  )

  const raw = []
  for (const item of lensResults) {
    if (!item || !item.r || !Array.isArray(item.r.findings)) continue
    for (const f of item.r.findings) {
      if ((f.confidence || 0) < CONFIDENCE_GATE) continue
      raw.push({ ...f, lens: item.lens, lenses: [item.lens] })
    }
  }
  log(`round ${round}: raw ${raw.length} findings (confidence≥${CONFIDENCE_GATE}) / ${LENSES.length} lenses`)

  const deduped = dedupe(raw).filter((f) => !seen.has(normalizeKey(f)))
  if (!deduped.length) {
    roundStats.push({ round, raw: raw.length, deduped: 0, verified: 0, newHigh: 0 })
    break
  }

  phase('Verify')
  const VERIFY_LENSES = [
    'reproduce: この指摘は実際にこの diff のコード上で発火するか。踏まれない/既存挙動の継承/机上の空論なら refuted=true。',
    'grounding: evidence と file:line が実ファイル・実差分と一致するか。不一致・推測・自己申告・行ズレなら refuted=true。',
    'domain: ドメイン/仕様に関する主張が正しいか。ドメイン文書と矛盾、または過剰解釈・仕様の読み違いなら refuted=true。',
  ].slice(0, VERIFY_VOTES)

  const verified = await parallel(
    deduped.map((f) => () =>
      parallel(
        VERIFY_LENSES.map((vl) => () =>
          agent(
            [
              'あなたは懐疑的な検証者。次のレビュー指摘を敵対的に検証し、refute できるか判定する。',
              LOCKDOWN,
              localNote,
              domainNote,
              `検証観点 → ${vl}`,
              `## 検証対象の指摘\n- lens: ${f.lens}\n- severity: ${f.severity} / confidence: ${f.confidence}\n- file: ${f.file}\n- title: ${f.title}\n- evidence: ${f.evidence}\n- suggestion: ${f.suggestion}`,
              diffSection,
              '対象ファイルを Read して確認する。確信が持てない・根拠が弱いときは refuted=true を既定にする（偽陽性を通さない）。severity が過大/過小と判断したら adjustedSeverity を返す。',
            ].join('\n\n'),
            { label: `verify:${f.lens}`, phase: 'Verify', model: 'sonnet', schema: VERDICT_SCHEMA },
          ),
        ),
      ).then((votes) => {
        const valid = votes.filter(Boolean)
        if (!valid.length) return null
        const refutes = valid.filter((v) => v.refuted).length
        // 精度優先のストリクト多数決: 「refute しない」側が厳密過半数のときだけ生存する。
        // refutes < ceil(n/2) → n=1:0許容, n=2:0許容(同数1-1は棄却), n=3:1許容。
        // votes を増やすほど 1 票の反対を許容できる（= 深度が上がるほど頑健）。
        const survives = refutes < Math.ceil(valid.length / 2)
        if (!survives) return null
        // 複数 verifier が severity を補正したら最も重いものを採る（first-wins にしない）。
        const adjustedSeverity = valid
          .map((v) => v.adjustedSeverity)
          .filter(Boolean)
          .reduce((best, s) => ((SEVERITY_RANK[s] || 0) > (SEVERITY_RANK[best] || 0) ? s : best), undefined)
        return { ...f, verifiedVotes: valid.length, refutes, adjustedSeverity }
      }),
    ),
  )

  const survivors = verified.filter(Boolean)
  // 生存者だけでなく、この round で verify に落ちた指摘も seen に入れる。
  // そうしないと後続 round で lens が同じ指摘を再提案し、無駄な verify が走る。
  deduped.forEach((f) => seen.add(normalizeKey(f)))
  confirmedAll.push(...survivors)
  const newHigh = survivors.filter(
    (f) => (SEVERITY_RANK[f.adjustedSeverity || f.severity] || 0) >= 3,
  ).length
  roundStats.push({ round, raw: raw.length, deduped: deduped.length, verified: survivors.length, newHigh })
  log(
    `round ${round}: ${survivors.length}/${deduped.length} findings が敵対検証を生存（high+ ${newHigh}）`,
  )

  // 追加ラウンドは high 以上の新規が出た時だけ価値がある。0 なら打ち切り。
  if (newHigh === 0) break
}

const confirmed = confirmedAll
  .map((f) => ({ ...f, severity: f.adjustedSeverity || f.severity }))
  .sort(
    (a, b) =>
      (SEVERITY_RANK[b.severity] || 0) - (SEVERITY_RANK[a.severity] || 0) ||
      (b.confidence || 0) - (a.confidence || 0),
  )

return {
  target,
  baseCommit,
  cwd,
  effort,
  lensCount: LENSES.length,
  verifyVotes: VERIFY_VOTES,
  maxRounds: MAX_ROUNDS,
  rounds: roundStats,
  confirmedCount: confirmed.length,
  confirmed,
}
