import { Navigate, useNavigate, useParams } from 'react-router-dom'
import { repos } from '../../db/repositories'
import { ONBOARDING_ORDER, SECTIONS, type SectionKey } from '../setup/sections'

const STEPS = ['welcome', ...ONBOARDING_ORDER, 'done'] as const

/** First-run walkthrough of Setup in SPEC order. Everything can be changed later in Settings. */
export function Onboarding() {
  const { step = 'welcome' } = useParams()
  const navigate = useNavigate()
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
  } else if (step === 'done') {
    body = (
      <>
        <h1>You’re set up</h1>
        <p className="intro">
          Daily limits, rules and focus-timer defaults start with sensible values — adjust them anytime in Settings.
        </p>
        <p className="muted">Next, you’ll add your goals on the Goals tab.</p>
      </>
    )
  } else {
    const { title, intro, Component } = SECTIONS[step as SectionKey]
    body = (
      <>
        <p className="step-count">
          Step {index} of {ONBOARDING_ORDER.length}
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
