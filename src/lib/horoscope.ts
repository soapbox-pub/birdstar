/**
 * Deterministic daily horoscope generator.
 *
 * Horoscopes are not derived from any astronomical truth — every
 * newspaper column, app, and free "aztro-style" API is ultimately
 * authored prose (human-written or template-generated) riffing off the
 * sign's archetype. Rather than take a runtime dependency on an
 * external service that can go down, rate-limit, or quietly change its
 * wording, Starpoint ships its own content bank and stitches a
 * horoscope together locally.
 *
 * Determinism matters for two reasons:
 *   1. Every user who opens the same sign on the same calendar day
 *      sees the same reading, which makes it a shared reference (you
 *      can talk about it in comments, screenshot it, etc.).
 *   2. The generator needs no storage, no network, and no clock skew
 *      handling — we just hash (sign + date) and sample from frozen
 *      arrays.
 *
 * The content bank is organised as four rotating themes:
 *   - `openings`  — set the tone / ground the reader in the sign
 *   - `focus`     — the day's active thread (work, creativity, relationships)
 *   - `cautions`  — a soft warning or thing to watch for
 *   - `closings`  — a forward-looking nudge
 *
 * With ~5 entries per theme across 12 signs this yields 5^4 = 625
 * possible compositions per sign before any repetition, which is more
 * than enough to keep daily readers from noticing the loop. The
 * per-sign `moods` and `lucky numbers` add another layer of variation.
 *
 * None of this pretends to be "real" astrology; it's genre fiction
 * keyed off established sign archetypes, same as every free horoscope
 * API on the market.
 */

import type { ZodiacId } from "./zodiac";
import { fnv1a, localDateKey, mulberry32, pick } from "./seededRandom";

/** Themed prose fragments that compose a daily reading for one sign. */
interface SignContent {
  /** Opening sentence — grounds the reader in the sign's voice. */
  openings: readonly string[];
  /** Middle — the day's active focus. */
  focus: readonly string[];
  /** A soft warning or pitfall to sidestep. */
  cautions: readonly string[];
  /** Forward-looking closing sentence. */
  closings: readonly string[];
  /** Mood adjectives sampled alongside the paragraph. */
  moods: readonly string[];
}

/**
 * Hand-authored content per sign. Voices are loosely tuned to element
 * (fire assertive, earth grounded, air curious, water reflective) but
 * kept generic enough that any reading makes sense on any day — we
 * don't condition on real transits.
 */
const CONTENT: Record<ZodiacId, SignContent> = {
  aries: {
    openings: [
      "A spark you've been sitting with finally wants to move.",
      "Your usual forward momentum sharpens today into something more deliberate.",
      "The restless energy you woke up with is asking for a target, not a distraction.",
      "You're in a starting mood, even if the world hasn't noticed yet.",
      "A fresh clarity cuts through yesterday's noise around mid-morning.",
    ],
    focus: [
      "A small initiative you take before noon compounds further than expected.",
      "Direct conversation will land better than a carefully worded message — say it plainly.",
      "Channel the heat into one project, not five, and watch something actually ship.",
      "A physical outlet — a walk, a workout, a hands-on task — unsticks a mental knot.",
      "Leadership today looks like going first, not going loudest.",
    ],
    cautions: [
      "Impatience will cost you a conversation that matters; breathe before you reply.",
      "Don't confuse speed with progress on something that needs to simmer.",
      "A wound to the ego this morning is smaller than it feels — let it pass.",
      "Pushing through someone else's hesitation today will read as pressure, not confidence.",
      "The argument you're about to win isn't actually the one worth having.",
    ],
    closings: [
      "By evening, the day rewards whoever acted first.",
      "Sleep on the boldest idea — it'll still look right tomorrow.",
      "A small risk before sundown tilts the week in your favour.",
      "What you committed to today will read as courageous in hindsight.",
      "You end the day lighter than you began it.",
    ],
    moods: ["driven", "electric", "impatient", "daring", "forthright"],
  },
  taurus: {
    openings: [
      "Slowness is not the enemy today — it's the whole point.",
      "Something solid you've been tending quietly is ready to be noticed.",
      "The ground under your feet feels steadier than it has in a while.",
      "You wake up in a body that wants pleasure, not productivity.",
      "A sense of 'enough' settles in where striving used to live.",
    ],
    focus: [
      "Tend to something you own — a room, a recipe, a routine — and it'll tend back.",
      "Money conversations go well if you let the numbers speak before the feelings do.",
      "A sensory pleasure you normally rush through deserves your full attention.",
      "Say no to one thing so you can say yes to something more substantial.",
      "The patient option is also, this week, the ambitious one.",
    ],
    cautions: [
      "Stubbornness will look like strength until about 4pm, then it won't.",
      "A comfort you're reaching for is slightly past comforting you.",
      "Don't dig in on a position you adopted yesterday out of pride.",
      "Overindulgence tonight will cost you tomorrow's focus.",
      "You're holding on to something that's already quietly changed.",
    ],
    closings: [
      "Something you build today will still be standing in a year.",
      "A quiet evening is more productive than it looks.",
      "You'll sleep well if you let the day actually end.",
      "The slow lane wins by a longer margin than usual.",
      "What you refuse to hurry will arrive anyway, intact.",
    ],
    moods: ["grounded", "languid", "deliberate", "sensual", "unbothered"],
  },
  gemini: {
    openings: [
      "Two ideas bump into each other this morning and something new falls out.",
      "Your mind is a browser with too many tabs, and one of them is important.",
      "A conversation overheard or half-remembered threads into the day's theme.",
      "You wake up curious about something that won't matter by Friday — follow it anyway.",
      "Today wants to be read, talked over, and annotated.",
    ],
    focus: [
      "Write the message you've been drafting in your head — the real audience is ready.",
      "Let yourself change your mind publicly; no one's keeping score except you.",
      "A light, unplanned social window opens mid-afternoon — take it.",
      "You'll learn more from asking a naive question than from pretending you knew.",
      "A short piece of writing, said or written, shifts someone's day for the better.",
    ],
    cautions: [
      "Scattering yourself across six group chats will feel productive and won't be.",
      "Restate the thing before you reply — you're about to answer a question no one asked.",
      "A rumour you're tempted to repeat won't survive daylight.",
      "Being interesting is not the same as being honest; pick the latter today.",
      "You're explaining when you should be listening.",
    ],
    closings: [
      "An evening conversation reframes the whole week.",
      "Capture the thought before bed — it's the one that matters.",
      "A loose plan made tonight will find its own shape by Thursday.",
      "Someone is waiting for you to follow up; do it before you forget.",
      "You end the day with a clearer question than the one you started with.",
    ],
    moods: ["curious", "mercurial", "chatty", "light-footed", "sharpened"],
  },
  cancer: {
    openings: [
      "Your intuition is quieter than usual this morning — and, for once, correct.",
      "Home feels like the right place to start the day, even if you have to leave it.",
      "A feeling from earlier this week finally has a name.",
      "Tenderness isn't weakness today; it's strategic.",
      "Something you've been protecting is ready to breathe.",
    ],
    focus: [
      "Tend to the room, the meal, the message — small domestic acts accumulate.",
      "A kindness sent now will matter more than a grand gesture later.",
      "Trust the gut read on a person; the evidence will catch up by Wednesday.",
      "Say the caring thing out loud — it's doing no one any good inside your head.",
      "Protect your morning, and the afternoon will protect itself.",
    ],
    cautions: [
      "Withdrawing into the shell will feel safe and will delay what needs saying.",
      "Don't take on someone else's weather as if it were your own.",
      "An old hurt is surfacing — notice it without relitigating it.",
      "Moodiness before lunch is not a mandate for decisions after it.",
      "You're reading subtext that isn't there.",
    ],
    closings: [
      "Evening softens what the morning bruised.",
      "A quiet ritual you do tonight carries the next three days.",
      "The person you think of before sleep is the right one to reach out to tomorrow.",
      "You'll dream clearly; pay attention.",
      "The nest you make tonight is a small act of self-respect.",
    ],
    moods: ["tender", "watchful", "nostalgic", "protective", "intuitive"],
  },
  leo: {
    openings: [
      "You walk in the room a little taller today, and the room notices.",
      "Your generosity is the current that moves everything else along.",
      "A creative impulse you sat on last week wants its moment.",
      "The spotlight finds you without you having to ask for it.",
      "You wake up knowing something about yourself that you didn't yesterday.",
    ],
    focus: [
      "Make the thing, and share it before you overthink the finish.",
      "A public compliment you give today lands harder than a private one.",
      "Dress for the day you want — the theatre of it is half the magic.",
      "Lead with warmth, not authority, and watch the room open.",
      "A creative risk in the first half of the day pays back by evening.",
    ],
    cautions: [
      "Applause isn't feedback; don't confuse the two when you revise.",
      "A slight you perceived this morning was probably a bad inbox day, not a signal.",
      "Pride will tell you to double down on a position that's quietly softening.",
      "Performing confidence is more tiring than admitting you're figuring it out.",
      "Don't mistake attention for agreement.",
    ],
    closings: [
      "Someone is telling a story about you tonight, and it's a good one.",
      "You end the day with more warmth than you started it with.",
      "A creative spark lit today will still be glowing in a week.",
      "Rest well — even the sun sets.",
      "Tomorrow picks up exactly where tonight leaves off.",
    ],
    moods: ["radiant", "generous", "theatrical", "open-hearted", "commanding"],
  },
  virgo: {
    openings: [
      "The day rewards precision in small things over ambition in large ones.",
      "Your eye for detail is sharper than anyone around you realises.",
      "A list made before 10am is the single most useful object in your day.",
      "You notice what's out of place before you notice what's working — redirect.",
      "Craft, not speed, is the through-line of today.",
    ],
    focus: [
      "A small repair, physical or emotional, outperforms the grand gesture.",
      "Your service to someone this afternoon quietly alters their week.",
      "Refactor the thing — the messy version has already taught you enough.",
      "Say the honest, specific, useful sentence; skip the soft preamble.",
      "The deadline you're worried about is friendlier than you think if you start now.",
    ],
    cautions: [
      "Perfection will try to disguise itself as diligence; it isn't.",
      "Criticism you aim inward today will leak outward by evening.",
      "Overworking a draft past its clarity point makes it worse, not better.",
      "Don't audit a friendship the way you'd audit a spreadsheet.",
      "The anxiety is information, not instruction — don't act on every pulse.",
    ],
    closings: [
      "Something quietly improved today will be obvious next week.",
      "Leave one thing undone on purpose — the world will hold it for you.",
      "You earn the rest; take it.",
      "A clean desk tonight is half of tomorrow's clarity.",
      "You'll be grateful in three days for something boring you did tonight.",
    ],
    moods: ["precise", "thorough", "observant", "measured", "clear-headed"],
  },
  libra: {
    openings: [
      "You're looking for the fair answer, and for once it's also the easy one.",
      "Beauty matters today — not as decoration, but as information.",
      "A relationship conversation wants the mild version of your honesty.",
      "You're drawn to symmetry, and there's a reason — something's tilted.",
      "The air around you is social, light, a little performative; enjoy it.",
    ],
    focus: [
      "Say the thing diplomatically — the truth survives good manners.",
      "A partnership decision made today holds for longer than you'd expect.",
      "Aesthetic choices matter more than usual; trust the impulse.",
      "Mediate a small conflict that isn't yours and the favour is remembered.",
      "Pair up with the person who complements rather than mirrors you.",
    ],
    cautions: [
      "Indecision is a decision, and today it's the wrong one.",
      "Don't smooth over the disagreement — it'll resurface less polite.",
      "Being liked isn't the same as being heard.",
      "A compromise made to end the conversation will cost you twice later.",
      "Charm is a tool, not an argument.",
    ],
    closings: [
      "A balanced day ends on a grace note.",
      "Beauty you create tonight outlasts the mood that made it.",
      "You'll sleep easier for having picked a side.",
      "The partnership you tend to today is the one that shows up for you next week.",
      "Fairness looks good on you — keep it.",
    ],
    moods: ["poised", "charming", "fair-minded", "aesthetic", "sociable"],
  },
  scorpius: {
    openings: [
      "Something is surfacing — not because you disturbed it, but because it's time.",
      "You see through today's small performances with almost unfair clarity.",
      "A truth you've been circling lets you finally touch it.",
      "Intensity is yours for the day; decide what it's for.",
      "You're not in the mood for small talk, and you're right.",
    ],
    focus: [
      "One frank conversation changes the shape of a relationship for the better.",
      "Money or resources — your own or shared — want a clear-eyed look.",
      "A secret you're carrying is heavier than the thing it's hiding.",
      "Trust the quiet suspicion — evidence arrives by end of week.",
      "Cut the tie you've been loosening for months — the cleaner break is kinder.",
    ],
    cautions: [
      "You can scorch the bridge and still regret the view.",
      "Holding a grudge today costs you more metabolism than it's worth.",
      "A paranoia is trying to borrow an intuition's credibility; check which is which.",
      "Power moves made from wounded pride don't age well.",
      "Privacy is yours, but isolation is not the same thing.",
    ],
    closings: [
      "What you face tonight has less power over you by tomorrow morning.",
      "A door quietly closes, and the next one is already unlocked.",
      "Sleep dissolves more than it should; let it.",
      "You're changing; the people who matter will keep up.",
      "The day ends heavier, but cleaner.",
    ],
    moods: ["intense", "penetrating", "unflinching", "magnetic", "private"],
  },
  sagittarius: {
    openings: [
      "The horizon line in your head is a little farther out today than it was.",
      "Something big-picture clicks while you're doing something small.",
      "Your appetite for elsewhere is back — feed it in a practical way.",
      "You wake up with a thesis, not a to-do list.",
      "The day wants to be spent honestly or not at all.",
    ],
    focus: [
      "Tell the truth with the volume turned down — it lands harder that way.",
      "A book, a conversation, a route you've never taken — one of these reroutes the week.",
      "Zoom out before you answer — the strategic view is the kind one.",
      "Teach the thing you know, and you'll learn the next thing.",
      "Go somewhere you don't usually go, even if it's only four blocks away.",
    ],
    cautions: [
      "Blunt is not automatically honest; check the cost before you swing.",
      "Overpromising today is tomorrow's quiet resentment — halve it.",
      "Escape and growth look similar from the inside; make sure you're choosing growth.",
      "A grand plan made before coffee is usually a mood, not a plan.",
      "Don't lecture someone you're actually asking for reassurance.",
    ],
    closings: [
      "You end the day with a bigger world than you started it with.",
      "A promise made tonight is worth keeping simply.",
      "Something you were curious about answers you back.",
      "You'll sleep well in a room that isn't your usual one.",
      "Tomorrow opens wider for what you chose today.",
    ],
    moods: ["expansive", "candid", "restless", "optimistic", "questing"],
  },
  capricornus: {
    openings: [
      "The long game looks, for once, like the obvious game.",
      "You wake up structurally — the architecture of the week is already there.",
      "Discipline feels less like effort today and more like identity.",
      "Something you've been building in private earns its first real test.",
      "Responsibility sits comfortably on your shoulders.",
    ],
    focus: [
      "The boring, durable option is also the right one — take it without apology.",
      "A professional conversation goes further if you go in with the ask, not the context.",
      "Show the work — reliability is your quiet superpower today.",
      "Plan the week before you execute the day.",
      "A small act of mentorship you do this morning travels further than expected.",
    ],
    cautions: [
      "Work isn't worth is not an ethic; rest before you resent what you're doing.",
      "Cynicism will present itself as realism — it isn't.",
      "Don't measure today's worth only in what you produced.",
      "A standard you'd never hold a friend to is the one you're holding yourself to.",
      "You're climbing a ladder you already summited; notice the view.",
    ],
    closings: [
      "Something you did quietly today is the foundation of something later.",
      "The evening is yours — actually take it.",
      "You'll sleep easier knowing one thing is genuinely done.",
      "Tomorrow arrives already a little easier because of tonight.",
      "Reward yourself materially for once; you've earned more than the feedback.",
    ],
    moods: ["disciplined", "assured", "methodical", "stoic", "ambitious"],
  },
  aquarius: {
    openings: [
      "The obvious answer bores you today, and it should.",
      "A group you belong to needs a slightly different shape than it has.",
      "An idea from the edge of your interests wants to come into the middle.",
      "You wake up outside the building everyone else is arguing inside.",
      "Something you've always done a certain way is asking for a redesign.",
    ],
    focus: [
      "The unusual framing is the useful one — offer it.",
      "A friendship you've let drift wants a small, specific touch today.",
      "Systems thinking beats heroics; fix the process, not the symptom.",
      "Publish the half-baked idea — the feedback is worth more than the polish.",
      "Be the one who names the elephant in the room, kindly.",
    ],
    cautions: [
      "Aloofness will read as disinterest, even when you're actually invested.",
      "Don't contrarian yourself out of a good idea just because the crowd agrees.",
      "Emotional distance is not a virtue today, even if it's a comfort.",
      "A theory is waiting to become a conversation — don't keep it abstract.",
      "You're prescribing to a situation that was asking to be witnessed.",
    ],
    closings: [
      "A small rewiring you start tonight reshapes something larger next month.",
      "The friend you message before bed is glad you did.",
      "You end the day with a weirder and better plan.",
      "Sleep loosens an idea that's been locked up all week.",
      "The future you're quietly building shows up a little sooner than expected.",
    ],
    moods: ["inventive", "detached", "principled", "eccentric", "egalitarian"],
  },
  pisces: {
    openings: [
      "The membrane between your inner and outer weather is thin today — dress accordingly.",
      "A dream from last night is still, usefully, in the room.",
      "Something wordless wants to be made into something — a note, a sketch, a walk.",
      "Your compassion is accurate today; trust what it reports back.",
      "You wake up in the mood for music, for water, for a slower thought.",
    ],
    focus: [
      "Make the creative thing, however small — it'll be the honest part of the day.",
      "An act of quiet care for someone tired matters more than you'll be told.",
      "Let yourself drift for an hour — it counts as work, for you.",
      "The artistic instinct and the emotional instinct are the same one today; listen once.",
      "A boundary you finally name is a gift to everyone, including yourself.",
    ],
    cautions: [
      "Absorbing someone else's mood is not the same as being helpful.",
      "Escapism is wearing the costume of rest today — tell them apart.",
      "Don't agree to something just to make the discomfort end.",
      "A fantasy is romantic until you mistake it for a plan.",
      "You're dissolving where you should be clarifying.",
    ],
    closings: [
      "Tonight, soft things — warm drink, soft light, no screens — do real work.",
      "A dream tonight leaves behind a small, usable image.",
      "Something creative you touched today continues to make itself while you sleep.",
      "You'll wake clearer than you slept.",
      "A quiet evening refills more than a busy one ever could.",
    ],
    moods: ["dreamy", "empathic", "fluid", "receptive", "tender"],
  },
};

/** Result of generating a daily horoscope. */
export interface DailyHoroscope {
  /** Multi-sentence paragraph for the sign on the given day. */
  paragraph: string;
  /** Single-word mood keyword. */
  mood: string;
  /** Lucky number in the 1–99 range. */
  luckyNumber: number;
  /** ISO `YYYY-MM-DD` key the horoscope was computed for. */
  dateKey: string;
}

/**
 * Compute the horoscope for a sign on a given date. Pure function:
 * same inputs → same output, always. Callers should normally pass
 * `new Date()` for the current day, but injecting a date makes the
 * function trivially testable.
 */
export function horoscopeFor(sign: ZodiacId, date: Date): DailyHoroscope {
  const dateKey = localDateKey(date);
  const seed = fnv1a(`${sign}:${dateKey}`);
  const rand = mulberry32(seed);

  const content = CONTENT[sign];
  // Sample one line from each themed bank. Order matters here — we
  // deliberately advance the PRNG the same way every time so the
  // result is fully reproducible.
  const opening = pick(content.openings, rand);
  const focus = pick(content.focus, rand);
  const caution = pick(content.cautions, rand);
  const closing = pick(content.closings, rand);
  const mood = pick(content.moods, rand);
  // Lucky number in [1, 99]. We use a full 32-bit unsigned draw so
  // the modulo bias at this range is negligible.
  const luckyNumber = (Math.floor(rand() * 99) % 99) + 1;

  return {
    paragraph: `${opening} ${focus} ${caution} ${closing}`,
    mood,
    luckyNumber,
    dateKey,
  };
}
