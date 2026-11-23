import { Navigate, useNavigate, useParams } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { format } from 'date-fns'
import { GoalCard } from '../goals/GoalCard'
import { goalOrder } from '../goals/GoalsScreen'
import { TemplatePicker } from '../goals/TemplatePicker'
import { repos } from '../../db/repositories'
import { ONBOARDING_ORDER, SECTIONS, type SectionKey } from '../setup/sections'

// SPEC §5: sleep → fixed program → meals → locations → availability → first goal
const STEPS = ['welcome', ...ONBOARDING_ORDER, 'goal', 'done'] as const
const STEP_COUNT = ONBOARDING_ORDER.length + 1

/** First-run walkthrough of Setup in SPEC order. Everything can be changed later in Settings. */
export function Onboarding() {
  const { step = 'welcome' } = useParams()
  const navigate = useNavigate()
  const goals = useLiveQuery(() => repos.goals.all(), [], [])
  const index = STEPS.indexOf(step as (typeof STEPS)[number])
  if (index < 0) return <Navigate to="/onboarding/welcome" replace />

  const go = (i: number) => navigate(`/onboarding/${STEPS[i]}`)
  const finish = async () => {
    await repos.settings.update({ onboardingDone: true })
    navigate('/today', { replace: true })
  }

  let body
  if (step === 'welcome') {
    body = (
      <>
        <h1>Welcome to Agenda</h1>
        <p className="intro">
          Let’s set up your week so the plan is actually doable: when you sleep, your fixed program, meals, the places you
          go and your free time. It takes a few minutes, and you can change everything later in Settings.
        </p>
        <p className="muted">Everything stays on this iPad. Nothing is sent anywhere.</p>
      </>
    )
  } else if (step === 'goal') {
    const today = format(new Date(), 'yyyy-MM-dd')
    body = (
      <>
        <p className="step-count">
          Step {STEP_COUNT} of {STEP_COUNT}
        </p>
        <h1>{goals.length ? 'Your goals' : 'Your first goal'}</h1>
        <p className="muted intro">
          What do you want to make time for? Pick a starting point. You can add more goals now or later on the Goals tab.
        </p>
        {goals.length > 0 && (
          <div className="goal-list">
            {[...goals].sort(goalOrder).map((g) => (
              <GoalCard key={g.id} goal={g} to={`/onboarding/goal/${g.id}`} today={today} />
            ))}
          </div>
        )}
        {goals.length > 0 && <h2>Add another</h2>}
        <TemplatePicker base="/onboarding/goal/new" replace={false} />
      </>
    )
  } else if (step === 'done') {
    body = (
      <>
        <h1>You’re set up</h1>
        <p className="intro">
          Daily limits, rules and focus-timer defaults start with sensible values — adjust them anytime in Settings.
        </p>
        <p className="muted">
          {goals.length
            ? 'Your plan is built from your goals and free time. Add or change goals anytime on the Goals tab.'
            : 'Add goals anytime on the Goals tab — the planner fits them into your free time.'}
        </p>
      </>
    )
  } else {
    const { title, intro, Component } = SECTIONS[step as SectionKey]
    body = (
      <>
        <p className="step-count">
          Step {index} of {STEP_COUNT}
        </p>
        <h1>{title}</h1>
        <p className="muted intro">{intro}</p>
        <Component base="/onboarding" />
      </>
    )
  }

  const last = index === STEPS.length - 1
  return (
    <div className="onboarding">
      <div className="onboarding-progress" aria-hidden>
        {STEPS.map((s, i) => (
          <span key={s} className={i <= index ? 'dot on' : 'dot'} />
        ))}
      </div>
      <section className="screen onboarding-body">{body}</section>
      <nav className="onboarding-nav">
        {index > 0 ? (
          <button type="button" className="btn" onClick={() => go(index - 1)}>
            Back
          </button>
        ) : (
          <button type="button" className="btn link" onClick={finish}>
            Skip setup
          </button>
        )}
        <button type="button" className="btn primary" onClick={() => (last ? finish() : go(index + 1))}>
          {index === 0 ? 'Start' : last ? 'Go to Today' : 'Next'}
        </button>
      </nav>
    </div>
  )
}
