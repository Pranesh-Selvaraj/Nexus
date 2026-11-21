import type { DomainPack } from '@nexus/shared-types';

export interface PackCard {
  front: string;
  back: string;
}

export interface DomainPackDefinition extends Omit<DomainPack, 'cardCount'> {
  cards: PackCard[];
}

/**
 * First-party domain packs (L-14). A pack is a curated starting point: a
 * persona, questions to ask, a short plan and a starter deck. Installing one
 * creates a normal topic, so everything remains editable and removable.
 */
export const DOMAIN_PACKS: DomainPackDefinition[] = [
  {
    id: 'language-spanish-a1',
    name: 'Spanish for beginners (A1)',
    domain: 'language',
    icon: '🇪🇸',
    description:
      'Everyday Spanish from zero: greetings, introductions, numbers and the present tense, with dictation and pronunciation practice.',
    personaId: 'language',
    starterPrompts: [
      'Teach me five greetings and when to use each one.',
      'Correct this sentence: Yo soy veinte años.',
      'Make a short A1 dialogue at a café and translate it.',
    ],
    plan: {
      title: 'Your first two weeks of Spanish',
      steps: [
        'Learn greetings and introductions; practise saying them aloud.',
        'Add the numbers 1–100 and practise with quick flashcard reviews.',
        'Meet regular present-tense verbs (-ar, -er, -ir) with one example each.',
        'Use dictation on short sentences to train listening.',
        'Record a pronunciation attempt and compare the per-word feedback.',
        'Review the starter deck until every card is scheduled beyond today.',
        'Write a five-sentence self-introduction and ask the tutor to correct it.',
      ],
    },
    cards: [
      { front: 'hola', back: 'hello' },
      { front: 'buenos días', back: 'good morning' },
      { front: 'gracias', back: 'thank you' },
      { front: 'por favor', back: 'please' },
      { front: '¿Cómo estás?', back: 'How are you?' },
      { front: 'Me llamo…', back: 'My name is…' },
    ],
  },
  {
    id: 'tech-python-foundations',
    name: 'Python foundations',
    domain: 'technology',
    icon: '🐍',
    description:
      'The Python essentials: values and containers, loops and functions, errors and virtual environments, explained with runnable examples.',
    personaId: 'code-mentor',
    starterPrompts: [
      'Explain the difference between a list and a tuple with examples.',
      'Why does this code mutate the list I passed in?',
      'Give me three exercises on dictionaries, easiest first.',
    ],
    plan: {
      title: 'A week of Python fundamentals',
      steps: [
        'Values, variables and the difference between str, int and float.',
        'Lists, tuples, sets and dicts: when to reach for each one.',
        'Control flow: if, for, while, and comprehensions.',
        'Functions, arguments, return values and scope.',
        'Reading tracebacks and raising your own exceptions.',
        'Virtual environments and installing a package.',
        'Build a small script (a word counter) and ask the tutor to review it.',
      ],
    },
    cards: [
      {
        front: 'list vs tuple',
        back: 'A list is mutable; a tuple is immutable and hashable.',
      },
      {
        front: 'dict lookup',
        back: 'Use d[key] when the key must exist, d.get(key, default) when it may not.',
      },
      {
        front: 'for loop',
        back: 'Iterates over items directly: for item in items: …',
      },
      {
        front: 'function',
        back: 'Defined with def name(args): and returns with return value.',
      },
      {
        front: 'virtualenv',
        back: 'An isolated Python environment that keeps project dependencies separate.',
      },
      {
        front: 'exception',
        back: 'Raised with raise, handled with try/except/finally.',
      },
    ],
  },
  {
    id: 'art-reading-paintings',
    name: 'How to read a painting',
    domain: 'art',
    icon: '🎨',
    description:
      'Look longer and describe before you interpret: composition, light, colour, technique and context, practised on any artwork you bring.',
    personaId: 'art-critic',
    starterPrompts: [
      'Describe this painting before interpreting it.',
      'What is the light doing in this image, and why does it matter?',
      'Compare these two artworks and name three visible differences.',
    ],
    plan: {
      title: 'A guided looking practice',
      steps: [
        'Describe what is literally visible without interpreting.',
        'Map the composition: focal point, leading lines, balance.',
        'Study the light: direction, contrast, what it emphasises.',
        'Name the palette and how colour creates mood.',
        'Identify technique from visible marks: brushwork, impasto, glazing.',
        'Place the work in context only after the description.',
        'Write a short critique using the same order: observe, then interpret.',
      ],
    },
    cards: [
      {
        front: 'composition',
        back: 'The arrangement of elements in the frame: balance, focal point, lines.',
      },
      {
        front: 'chiaroscuro',
        back: 'Strong contrast between light and dark to model form and drama.',
      },
      {
        front: 'impasto',
        back: 'Thickly applied paint that leaves visible texture and marks.',
      },
      {
        front: 'perspective',
        back: 'Technique for representing depth and space on a flat surface.',
      },
      {
        front: 'iconography',
        back: 'The visual symbols and their conventional meanings in a work.',
      },
    ],
  },
  {
    id: 'science-cell-biology',
    name: 'Cell biology essentials',
    domain: 'science',
    icon: '🧬',
    description:
      'What a cell is made of and how it works: organelles, membranes, transport, division and the central dogma, with Socratic checks.',
    personaId: 'socratic',
    starterPrompts: [
      'Quiz me on the functions of the main organelles.',
      'How does osmosis differ from diffusion?',
      'Walk me through mitosis one phase at a time.',
    ],
    plan: {
      title: 'Cell biology in seven sessions',
      steps: [
        'Prokaryotes vs eukaryotes: the essential differences.',
        'Organelles and their jobs, with a labelled diagram.',
        'The membrane and transport: diffusion, osmosis, active transport.',
        'Energy: mitochondria, chloroplasts, ATP.',
        'The central dogma: DNA → RNA → protein.',
        'The cell cycle and mitosis, phase by phase.',
        'Answer a past-exam question and mark it with the tutor.',
      ],
    },
    cards: [
      {
        front: 'mitochondria',
        back: 'Site of aerobic respiration and most ATP production.',
      },
      { front: 'ribosome', back: 'Translates mRNA into protein.' },
      {
        front: 'osmosis',
        back: 'Diffusion of water across a semi-permeable membrane to equalise solute concentration.',
      },
      {
        front: 'mitosis',
        back: 'Division producing two genetically identical daughter cells.',
      },
      {
        front: 'transcription',
        back: 'Copying a DNA sequence into messenger RNA.',
      },
    ],
  },
  {
    id: 'music-theory-basics',
    name: 'Music theory basics',
    domain: 'music',
    icon: '🎵',
    description:
      'Scales, intervals, keys and cadences: the vocabulary to understand what you hear and to explain why a progression works.',
    personaId: 'patient-explainer',
    starterPrompts: [
      'Explain a major scale using whole and half steps.',
      'What makes a perfect fifth sound stable?',
      'Why does this chord progression resolve so strongly?',
    ],
    plan: {
      title: 'Music theory in six short lessons',
      steps: [
        'Pitch, octaves and the chromatic scale.',
        'Whole and half steps: build a major scale.',
        'Intervals by number and quality, with listening examples.',
        'Key signatures and the circle of fifths.',
        'Chords: triads, major and minor.',
        'Cadences and why progressions feel finished or open.',
      ],
    },
    cards: [
      {
        front: 'major scale',
        back: 'Pattern of whole–whole–half–whole–whole–whole–half steps.',
      },
      {
        front: 'interval',
        back: 'The distance in pitch between two notes, named by number and quality.',
      },
      {
        front: 'key signature',
        back: 'The sharps or flats at the start of a staff that define the key.',
      },
      {
        front: 'circle of fifths',
        back: 'A diagram ordering keys by perfect-fifth relationships.',
      },
      {
        front: 'cadence',
        back: 'A harmonic formula that closes a phrase, e.g. V–I (authentic).',
      },
    ],
  },
];

export function findPack(id: string): DomainPackDefinition | undefined {
  return DOMAIN_PACKS.find((pack) => pack.id === id);
}

export function toDomainPack(pack: DomainPackDefinition): DomainPack {
  return {
    id: pack.id,
    name: pack.name,
    domain: pack.domain,
    icon: pack.icon,
    description: pack.description,
    personaId: pack.personaId,
    starterPrompts: pack.starterPrompts,
    plan: pack.plan,
    cardCount: pack.cards.length,
  };
}
