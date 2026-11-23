import type { ComponentType } from 'react'
import { SleepSection } from './SleepSection'
import { FixedProgramSection } from './FixedProgramSection'
import { MealsSection } from './MealsSection'
import { LocationsSection } from './LocationsSection'
import { AvailabilitySection, OverridesSection } from './AvailabilitySection'
import { RulesSection } from './RulesSection'
import { LimitsSection } from './LimitsSection'
import { DefaultsSection } from './DefaultsSection'

export interface SetupSection {
  key: string
  title: string
  intro: string
  /** `base` is where this section lives (/settings or /onboarding), for sub-pages. */
  Component: ComponentType<{ base: string }>
}

export const SECTIONS = {
  sleep: {
    key: 'sleep',
    title: 'Sleep',
    intro: 'When do you usually sleep? Nothing is ever planned in this window.',
    Component: SleepSection,
  },
  fixed: {
    key: 'fixed',
    title: 'Fixed program',
    intro: 'Classes, work and other commitments. They’re locked: the planner works around them and never moves them.',
    Component: ({ base }) => <FixedProgramSection editBase={`${base}/fixed`} />,
  },
  meals: {
    key: 'meals',
    title: 'Meals',
    intro: 'Each meal gets a flexible window and a duration. Meals are placed first, so the plan stays realistic.',
    Component: MealsSection,
  },
  locations: {
    key: 'locations',
    title: 'Places & travel',
    intro: 'Where you spend your day and how long it takes to get between places. Travel is added automatically.',
    Component: LocationsSection,
  },
  availability: {
    key: 'availability',
    title: 'Free time & energy',
    intro: 'Your usual free time each week, tagged with how much energy you tend to have.',
    Component: () => (
      <>
        <AvailabilitySection />
        <h2>One-off changes</h2>
        <p className="muted">“Busy all Saturday”, “free Friday afternoon” — these override your usual week.</p>
        <OverridesSection />
      </>
    ),
  },
  rules: {
    key: 'rules',
    title: 'Rules',
    intro: 'Hard rules the planner always follows.',
    Component: RulesSection,
  },
  limits: {
    key: 'limits',
    title: 'Daily limits',
    intro: 'How much goal work is realistic in one day, and the gap between sessions.',
    Component: LimitsSection,
  },
  defaults: {
    key: 'defaults',
    title: 'Focus timer & calendar',
    intro: 'Defaults for Focus Mode (goals can override them) and for calendar exports.',
    Component: DefaultsSection,
  },
} satisfies Record<string, SetupSection>

export type SectionKey = keyof typeof SECTIONS

/** Settings menu order. */
export const SETTINGS_ORDER: SectionKey[] = ['sleep', 'fixed', 'meals', 'locations', 'availability', 'rules', 'limits', 'defaults']

/** First-run order from SPEC §5: sleep → fixed program → meals → locations → availability (→ first goal, step 5). */
export const ONBOARDING_ORDER: SectionKey[] = ['sleep', 'fixed', 'meals', 'locations', 'availability']
