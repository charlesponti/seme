// One person's diary for five years, 2021-11-01 to 2026-10-31, generated from a seed.
//
// Life state moves through dated phases: city, job, partner, diagnoses, a parent's
// death. Each day has a chance of an entry with 1–3 first-person facts, rendered with
// paraphrase variety. Hard features (corrections, negations, hypotheticals, third-party
// claims, pronoun follow-ups) are layered on at a fixed rate. Gold labels come from the
// facts that were rendered, so the answer key is exact by construction.
//
// Every name, place and org is invented. Every named thing in an entry has a gold
// entity, so exhaustive precision can be scored.

import type { GoldEntity, GoldMemory, GoldRelation } from '../dataset.js';

export const START = '2021-11-01';
export const END = '2026-10-31';

export type Rng = () => number;

export function mulberry32(seed: number): Rng {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(rng: Rng, xs: readonly T[]): T {
  return xs[Math.floor(rng() * xs.length)]!;
}

export type Domain =
  | 'food'
  | 'people'
  | 'places'
  | 'money'
  | 'career'
  | 'health'
  | 'trips'
  | 'goals'
  | 'emotions'
  | 'pets'
  | 'hobbies';

export type HardFeature = 'correction' | 'negation' | 'hypothetical' | 'attribution' | 'pronoun';

const HARD_FEATURES: HardFeature[] = [
  'correction',
  'negation',
  'hypothetical',
  'attribution',
  'pronoun',
];

export interface Gold {
  entities: GoldEntity[];
  relations: GoldRelation[];
  memories: GoldMemory[];
  forbiddenEntities: string[];
  forbiddenRelations: { subject: string; object: string }[];
  forbiddenMemories: GoldMemory[];
}

export function noGold(): Gold {
  return {
    entities: [],
    relations: [],
    memories: [],
    forbiddenEntities: [],
    forbiddenRelations: [],
    forbiddenMemories: [],
  };
}

export function mergeGold(parts: Gold[]): Gold {
  const out = noGold();
  for (const p of parts) {
    out.entities.push(...p.entities);
    out.relations.push(...p.relations);
    out.memories.push(...p.memories);
    out.forbiddenEntities.push(...p.forbiddenEntities);
    out.forbiddenRelations.push(...p.forbiddenRelations);
    out.forbiddenMemories.push(...p.forbiddenMemories);
  }
  const seen = new Set<string>();
  out.entities = out.entities.filter((e) => {
    const k = e.name.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  return out;
}

export interface Fact {
  domain: Domain;
  text: string;
  gold: Gold;
  /** The person a fact centres on. A correction prefix targets this name. */
  person?: string;
}

export interface Entry {
  date: string;
  year: number;
  text: string;
  domains: Domain[];
  hard: HardFeature[];
  gold: Gold;
}

// ── Life state ────────────────────────────────────────────────────────────

export interface Life {
  city: string;
  employer: string;
  manager: string;
  project: string;
  partner: string | null;
  metformin: boolean;
  lisinopril: boolean;
  glutenFree: boolean;
  vegetarian: boolean;
  dadAlive: boolean;
  nora: boolean;
  biscuit: boolean;
  shellfish: boolean;
}

export function lifeOn(date: string): Life {
  const brightline = date < '2024-07-01';
  return {
    city: date >= '2025-06-01' ? 'Portland' : 'Austin',
    employer: brightline ? 'Brightline' : 'Northwind',
    manager: brightline ? 'Ravi' : 'Dana',
    project: brightline ? 'Atlas' : 'Beacon migration',
    partner: date < '2024-02-10' ? 'Maya' : date >= '2025-03-01' ? 'Theo' : null,
    metformin: date >= '2024-01-15' && date < '2025-09-01',
    lisinopril: date >= '2025-02-10',
    glutenFree: date >= '2023-04-01',
    vegetarian: date < '2023-03-01',
    dadAlive: date < '2026-02-14',
    nora: date >= '2024-06-10',
    biscuit: date >= '2024-04-01',
    shellfish: date >= '2023-01-01',
  };
}

// ── Vocabulary ────────────────────────────────────────────────────────────

const DISHES = [
  'pad thai',
  'lentil curry',
  'shakshuka',
  'carnitas tacos',
  'pho',
  'bibimbap',
  'paella',
  'carbonara',
  'miso soup',
  'chicken tikka',
];
const RESTAURANTS = [
  'Tamarind Kitchen',
  'Harbor Pho',
  'Lantern Ramen',
  'Ember & Oak',
  'Casa Verde',
  'Lowell Bagels',
];
const FRIENDS = ['Dev', 'Priya', 'Owen', 'Lucia'];
const WRONG_NAMES = ['Mark', 'Greg', 'Tess', 'Julia', 'Ben', 'Kenji'];
const ORGS = ['Kestrel Bank', 'Halcyon Labs', 'Tidewater Health'];
const HYPO_CITIES = ['Berlin', 'Tokyo', 'Oslo', 'Barcelona'];
const PURCHASES = [
  { item: 'standing desk', amt: '620' },
  { item: 'espresso machine', amt: '890' },
  { item: 'running shoes', amt: '135' },
];

interface Kin {
  name: string;
  role: string;
  he: boolean;
  cities: string[];
}
const KIN: Kin[] = [
  { name: 'Sam', role: 'brother', he: true, cities: ['Denver', 'Seattle', 'Chicago'] },
  { name: 'Mateo', role: 'cousin', he: true, cities: ['Miami', 'Phoenix'] },
  { name: 'Carmen', role: 'mom', he: false, cities: [] },
  { name: 'Robert', role: 'dad', he: true, cities: [] },
];

// ── Fact builders ─────────────────────────────────────────────────────────

function projectEntity(name: string): GoldEntity {
  return {
    name,
    type: 'project',
    aliases: [
      `${name} roadmap`,
      `${name} review`,
      `${name} deadline`,
      `${name} plan`,
      `${name} project`,
    ],
  };
}

function fact(domain: Domain, text: string, parts: Partial<Gold>, person?: string): Fact {
  return { domain, text, person, gold: { ...noGold(), ...parts } };
}

function tripFact(city: string, companion: string, text: string): Fact {
  return fact(
    'trips',
    text,
    {
      entities: [
        { name: city, type: 'place' },
        { name: companion, type: 'person' },
      ],
      relations: [
        { subject: 'user', object: city },
        { subject: 'user', object: companion, symmetric: true },
      ],
      memories: [{ must: [city.toLowerCase()] }, { must: [companion.toLowerCase()] }],
    },
    companion,
  );
}

type Maker = (c: Ctx) => Fact | null;
interface Ctx {
  rng: Rng;
  date: string;
  life: Life;
}

// Food and health

const cookedDish: Maker = (c) => {
  const d = pick(c.rng, DISHES);
  const text = pick(c.rng, [
    `Made ${d} for dinner tonight.`,
    `Cooked ${d} and the kitchen smelled great.`,
    `Dinner was ${d}, from scratch.`,
  ]);
  return fact('food', text, {
    entities: [{ name: d, type: 'food' }],
    relations: [{ subject: 'user', object: d }],
    memories: [{ must: [d] }],
  });
};

const mealOut: Maker = (c) => {
  const d = pick(c.rng, DISHES);
  const r = pick(c.rng, RESTAURANTS);
  const text = pick(c.rng, [
    `Had ${d} at ${r} on Friday.`,
    `We ate at ${r} and I got the ${d}.`,
    `Lunch at ${r}: ${d}, obviously.`,
  ]);
  return fact('food', text, {
    entities: [
      { name: r, type: 'place' },
      { name: d, type: 'food' },
    ],
    relations: [{ subject: 'user', object: r }],
    memories: [{ must: [r.toLowerCase()] }],
  });
};

const allergySelf: Maker = (c) => {
  const a = c.life.shellfish && c.rng() < 0.5 ? 'shellfish' : 'peanuts';
  const text = pick(c.rng, [
    `I'm allergic to ${a}.`,
    `${a[0]!.toUpperCase()}${a.slice(1)} gives me hives, so I avoid it completely.`,
    `Doctor confirmed my ${a} allergy, so I'm careful.`,
  ]);
  return fact('food', text, {
    entities: [{ name: a, type: 'food', aliases: [a.replace(/s$/, '')] }],
    relations: [{ subject: 'user', object: a }],
    memories: [{ must: [a] }, { must: [['allerg', 'hive', 'reaction', 'avoid']] }],
  });
};

const noraNutAllergy: Maker = (c) => {
  if (!c.life.nora) return null;
  const text = pick(c.rng, [
    'My daughter Nora has a tree nut allergy, so the bakery is off limits.',
    'Nora is allergic to tree nuts. We check every label now.',
  ]);
  return fact(
    'food',
    text,
    {
      entities: [
        { name: 'Nora', type: 'person' },
        { name: 'tree nuts', type: 'food', aliases: ['tree nut'] },
      ],
      relations: [
        { subject: 'user', object: 'Nora', symmetric: true },
        { subject: 'Nora', object: 'tree nuts' },
      ],
      memories: [{ must: ['nora'] }, { must: ['tree nut'] }],
      // The allergy is Nora's, not the user's.
      forbiddenRelations: [{ subject: 'user', object: 'tree nuts' }],
    },
    'Nora',
  );
};

const diet: Maker = (c) => {
  if (c.life.glutenFree) {
    return fact(
      'food',
      pick(c.rng, [
        "I'm still eating gluten-free, which is getting easier.",
        'Going gluten-free changed how I shop.',
      ]),
      {
        entities: [{ name: 'gluten-free', type: 'diet', aliases: ['gluten'] }],
        relations: [{ subject: 'user', object: 'gluten-free' }],
        memories: [{ must: ['gluten'] }],
      },
    );
  }
  if (c.life.vegetarian) {
    return fact(
      'food',
      pick(c.rng, [
        "I'm vegetarian, so I skipped the brisket.",
        "No meat for me, I'm vegetarian these days.",
      ]),
      {
        entities: [{ name: 'vegetarian', type: 'diet' }],
        relations: [{ subject: 'user', object: 'vegetarian' }],
        memories: [{ must: ['vegetarian'] }],
      },
    );
  }
  return null;
};

const medication: Maker = (c) => {
  if (c.life.metformin) {
    return fact(
      'health',
      pick(c.rng, [
        'I take metformin every morning with breakfast.',
        'Metformin with dinner again, as usual.',
      ]),
      {
        entities: [{ name: 'metformin', type: 'medication' }],
        relations: [{ subject: 'user', object: 'metformin' }],
        memories: [{ must: ['metformin'] }],
      },
    );
  }
  if (c.life.lisinopril) {
    return fact(
      'health',
      pick(c.rng, [
        'I take lisinopril every night now.',
        'Took my lisinopril with water, same as always.',
      ]),
      {
        entities: [{ name: 'lisinopril', type: 'medication' }],
        relations: [{ subject: 'user', object: 'lisinopril' }],
        memories: [{ must: ['lisinopril'] }],
      },
    );
  }
  return null;
};

// Career

const workLead: Maker = (c) => {
  const { project, employer } = c.life;
  return fact(
    'career',
    pick(c.rng, [
      `I'm leading the ${project} project at ${employer}.`,
      `${project} is my project at ${employer} now, lots of meetings.`,
    ]),
    {
      entities: [projectEntity(project), { name: employer, type: 'organization' }],
      relations: [
        { subject: 'user', object: employer },
        { subject: 'user', object: project },
      ],
      memories: [{ must: [project.toLowerCase()] }, { must: [employer.toLowerCase()] }],
    },
  );
};

const managerFeedback: Maker = (c) => {
  const m = c.life.manager;
  return fact(
    'career',
    pick(c.rng, [
      `${m} gave me feedback on the ${c.life.project} roadmap today.`,
      `${m} wants a revised ${c.life.project} plan by Friday.`,
    ]),
    {
      entities: [{ name: m, type: 'person' }, projectEntity(c.life.project)],
      relations: [{ subject: 'user', object: m, symmetric: true }],
      memories: [{ must: [m.toLowerCase()] }],
    },
    m,
  );
};

const workBusy: Maker = (c) => {
  const { employer, project } = c.life;
  return fact('career', `Long day at ${employer}, the ${project} deadline is close.`, {
    entities: [{ name: employer, type: 'organization' }, projectEntity(project)],
    relations: [
      {
        subject: 'user',
        object: employer,
        symmetric: true,
        alternatives: [{ subject: project, object: employer, symmetric: true }],
      },
    ],
    memories: [{ must: [employer.toLowerCase()] }, { must: [project.toLowerCase()] }],
  });
};

// Money

const rentPaid: Maker = (c) =>
  fact(
    'money',
    pick(c.rng, [
      'Paid Mr. Hale the rent, $2,450 this month.',
      'Rent went out to Mr. Hale, $2,450 as usual.',
    ]),
    {
      entities: [{ name: 'Mr. Hale', type: 'person' }],
      relations: [
        {
          subject: 'user',
          object: 'Mr. Hale',
          symmetric: true,
          alternatives: [{ subject: 'rent', object: 'Mr. Hale', symmetric: true }],
        },
      ],
      memories: [{ must: [['2,450', '2450']] }, { must: [['hale', 'rent']] }],
    },
  );

const purchase: Maker = (c) => {
  const p = pick(c.rng, PURCHASES);
  return fact('money', `I finally bought a ${p.item} for $${p.amt}, worth every dollar.`, {
    entities: [{ name: p.item, type: 'product' }],
    relations: [{ subject: 'user', object: p.item }],
    memories: [{ must: [p.item] }, { must: [p.amt] }],
  });
};

const savings: Maker = (c) =>
  c.rng() < 0.85
    ? null
    : fact('goals', "I'm trying to save $40,000 for a house by 2028, so no more impulse buys.", {
        entities: [{ name: 'house', type: 'goal' }],
        relations: [{ subject: 'user', object: 'house' }],
        memories: [{ must: [['40,000', '40000', '40k']] }, { must: ['house'] }],
      });

// Places, people, pets

const gymWithOwen: Maker = () =>
  fact(
    'places',
    'Lifted with Owen at Trailhead Gym this morning.',
    {
      entities: [
        { name: 'Owen', type: 'person' },
        { name: 'Trailhead Gym', type: 'place' },
      ],
      relations: [
        { subject: 'user', object: 'Owen', symmetric: true },
        { subject: 'user', object: 'Trailhead Gym' },
      ],
      memories: [{ must: ['owen'] }, { must: ['trailhead'] }],
    },
    'Owen',
  );

const parkRun: Maker = (c) => {
  const park = c.life.city === 'Austin' ? 'Zilker Park' : 'Forest Park';
  return fact('health', `Ran 8k around ${park} this morning.`, {
    entities: [{ name: park, type: 'place' }],
    relations: [{ subject: 'user', object: park }],
    memories: [{ must: [park.toLowerCase()] }, { must: [['8k', 'run', 'ran']] }],
  });
};

const friendNews: Maker = (c) => {
  const f = pick(c.rng, FRIENDS);
  if (f === 'Priya') {
    return fact(
      'people',
      `${f} just had a baby girl, we're all over the moon.`,
      {
        entities: [{ name: f, type: 'person' }],
        relations: [{ subject: 'user', object: f, symmetric: true }],
        memories: [{ must: [f.toLowerCase()] }, { must: [['baby', 'born']] }],
      },
      f,
    );
  }
  const r = pick(c.rng, RESTAURANTS);
  return fact(
    'people',
    `Had brunch with ${f} at ${r}, we talked for hours.`,
    {
      entities: [
        { name: f, type: 'person' },
        { name: r, type: 'place' },
      ],
      relations: [
        { subject: 'user', object: f, symmetric: true },
        { subject: 'user', object: r },
      ],
      memories: [{ must: [f.toLowerCase()] }, { must: [r.toLowerCase()] }],
    },
    f,
  );
};

const kinVisit: Maker = (c) => {
  const k = pick(c.rng, KIN);
  if (k.name === 'Robert' && !c.life.dadAlive) return null;
  const text = pick(c.rng, [
    `My ${k.role} ${k.name} is visiting next week.`,
    `${k.name}, my ${k.role}, is coming over for dinner on Sunday.`,
  ]);
  return fact(
    'people',
    text,
    {
      entities: [{ name: k.name, type: 'person', aliases: [k.role] }],
      relations: [{ subject: 'user', object: k.name, symmetric: true }],
      memories: [{ must: [k.name.toLowerCase()] }],
    },
    k.name,
  );
};

/** Pronoun follow-up: the second sentence refers back to the kin by "he" or "she". */
const kinMove = (c: Ctx): Fact => {
  const k = pick(
    c.rng,
    KIN.filter((x) => x.cities.length > 0),
  );
  const city = pick(c.rng, k.cities);
  const pron = k.he ? 'He' : 'She';
  return fact(
    'people',
    `My ${k.role} ${k.name} is visiting next week. ${pron} just moved to ${city}.`,
    {
      entities: [
        { name: k.name, type: 'person', aliases: [k.role] },
        { name: city, type: 'place' },
      ],
      relations: [
        { subject: 'user', object: k.name, symmetric: true },
        { subject: k.name, object: city },
      ],
      memories: [{ must: [k.name.toLowerCase()] }, { must: [city.toLowerCase()] }],
    },
    k.name,
  );
};

const juniperNote: Maker = (c) =>
  fact(
    'pets',
    pick(c.rng, [
      'Juniper knocked a glass off the counter again.',
      'Juniper is asleep on my laptop again.',
    ]),
    {
      entities: [{ name: 'Juniper', type: 'animal' }],
      relations: [{ subject: 'user', object: 'Juniper', symmetric: true, optional: true }],
      memories: [{ must: ['juniper'] }],
    },
  );

const biscuitNote: Maker = (c) => {
  if (!c.life.biscuit) return null;
  return fact('pets', 'Biscuit chewed up my slippers again.', {
    entities: [{ name: 'Biscuit', type: 'animal' }],
    relations: [{ subject: 'user', object: 'Biscuit', symmetric: true, optional: true }],
    memories: [{ must: ['biscuit'] }],
  });
};

// Emotions, hobbies, goals

const anxious: Maker = (c) =>
  fact('emotions', `I felt really anxious before the ${c.life.project} review.`, {
    entities: [projectEntity(c.life.project)],
    relations: [{ subject: 'user', object: c.life.project }],
    memories: [{ must: [['anxious', 'nervous', 'stressed']] }],
  });

const pride: Maker = (c) => {
  if (!c.life.nora) return null;
  return fact('emotions', 'Proud of Nora for her first steps today.', {
    entities: [{ name: 'Nora', type: 'person' }],
    relations: [{ subject: 'user', object: 'Nora', symmetric: true }],
    memories: [{ must: ['nora'] }, { must: [['proud', 'steps']] }],
  });
};

const lonely: Maker = (c) => {
  if (c.life.city !== 'Portland' || c.date >= '2026-01-01') return null;
  return fact(
    'emotions',
    'Felt lonely in Portland this week, I miss Austin and my friends there.',
    {
      entities: [
        { name: 'Portland', type: 'place' },
        { name: 'Austin', type: 'place' },
      ],
      memories: [{ must: [['lonely', 'alone']] }],
    },
  );
};

const grief: Maker = (c) => {
  if (c.life.dadAlive) return null;
  return fact('emotions', 'I miss Dad every day. Mom and I cried over his favorite soup.', {
    entities: [
      { name: 'Robert', type: 'person', aliases: ['Dad'] },
      { name: 'Carmen', type: 'person', aliases: ['Mom'] },
    ],
    relations: [
      { subject: 'user', object: 'Robert', symmetric: true },
      { subject: 'user', object: 'Carmen', symmetric: true },
    ],
    memories: [{ must: [['robert', 'dad']] }, { must: [['miss', 'grief', 'loss', 'cried']] }],
  });
};

const reading: Maker = () =>
  fact('hobbies', "I'm reading Piranesi by Susanna Clarke, it's wonderfully strange.", {
    entities: [
      { name: 'Piranesi', type: 'book' },
      { name: 'Susanna Clarke', type: 'person' },
    ],
    relations: [{ subject: 'user', object: 'Piranesi' }],
    memories: [{ must: ['piranesi'] }, { must: ['clarke'] }],
  });

const portuguese: Maker = (c) => {
  if (c.date < '2023-01-01' || c.date >= '2026-01-01') return null;
  return fact(
    'hobbies',
    "I'm learning Portuguese on the weekends, the Duolingo streak is at 200 days.",
    {
      entities: [{ name: 'Portuguese', type: 'language' }],
      relations: [{ subject: 'user', object: 'Portuguese' }],
      memories: [{ must: ['portuguese'] }],
    },
  );
};

const halfTraining: Maker = (c) => {
  if (c.date < '2024-03-01' || c.date >= '2024-10-06') return null;
  return fact('goals', "I'm training for a half marathon in October, long runs on Sundays.", {
    entities: [{ name: 'half marathon', type: 'event' }],
    relations: [{ subject: 'user', object: 'half marathon' }],
    memories: [{ must: [['half marathon', 'half-marathon']] }],
  });
};

const novel: Maker = (c) => {
  if (c.date < '2025-01-01') return null;
  return fact(
    'goals',
    "I'm writing a novel about lighthouse keepers, got 1,200 words done today.",
    {
      entities: [{ name: 'novel', type: 'project' }],
      relations: [{ subject: 'user', object: 'novel' }],
      memories: [{ must: ['novel'] }, { must: ['lighthouse'] }],
    },
  );
};

const MAKERS: Maker[] = [
  cookedDish,
  mealOut,
  allergySelf,
  noraNutAllergy,
  diet,
  medication,
  workLead,
  managerFeedback,
  workBusy,
  rentPaid,
  purchase,
  savings,
  gymWithOwen,
  parkRun,
  friendNews,
  kinVisit,
  juniperNote,
  biscuitNote,
  anxious,
  pride,
  lonely,
  grief,
  reading,
  portuguese,
  halfTraining,
  novel,
];

// Hard-feature facts

const negationFact = (c: Ctx): Fact => {
  const city = pick(c.rng, HYPO_CITIES);
  return fact(
    'trips',
    `I didn't end up going to ${city} after all, the flights were too expensive.`,
    {
      entities: [{ name: city, type: 'place' }],
      forbiddenRelations: [{ subject: 'user', object: city }],
      forbiddenMemories: [
        {
          must: [
            city.toLowerCase(),
            ['went to', 'visited', 'trip to', 'traveled to', 'travelled to', 'flew to'],
          ],
          modality: ['stated'],
        },
      ],
    },
  );
};

const hypoFact = (c: Ctx): Fact => {
  const city = pick(c.rng, HYPO_CITIES);
  return fact('goals', `Maybe I'll move to ${city} someday, we'll see.`, {
    entities: [{ name: city, type: 'place' }],
    forbiddenRelations: [{ subject: 'user', object: city }],
    forbiddenMemories: [
      { must: [city.toLowerCase(), ['mov', 'live', 'relocat']], modality: ['stated'] },
    ],
  });
};

const attributionFact = (c: Ctx): Fact => {
  const p = pick(c.rng, FRIENDS);
  const o = pick(c.rng, ORGS);
  return fact(
    'people',
    `${p} says ${o} is hiring a product manager.`,
    {
      entities: [
        { name: p, type: 'person' },
        { name: o, type: 'organization' },
      ],
      relations: [{ subject: p, object: o }],
      memories: [{ must: [p.toLowerCase()] }, { must: [o.toLowerCase()] }],
      // A hiring rumour is not a job the user or the friend holds.
      forbiddenRelations: [{ subject: 'user', object: o }],
      forbiddenMemories: [
        {
          must: [o.toLowerCase(), ['works at', 'working at', 'employed at', 'i work at']],
          modality: ['stated'],
        },
      ],
    },
    p,
  );
};

// ── Forced events on fixed dates ──────────────────────────────────────────

const FORCED: Record<string, Fact[]> = {
  '2021-11-01': [
    fact('places', 'We moved to Austin this week, the apartment is small but the porch is great.', {
      entities: [{ name: 'Austin', type: 'place' }],
      relations: [{ subject: 'user', object: 'Austin' }],
      memories: [{ must: ['austin'] }, { must: [['moved', 'move']] }],
    }),
  ],
  '2022-04-12': [
    tripFact(
      'Kyoto',
      'Maya',
      'Just got back from Kyoto with Maya, the cherry blossoms were unreal.',
    ),
  ],
  '2022-07-09': [
    fact(
      'money',
      'Dad lent me $5,000 for the security deposit, paying him back monthly.',
      {
        entities: [{ name: 'Robert', type: 'person', aliases: ['Dad'] }],
        relations: [{ subject: 'Robert', object: 'user', symmetric: true }],
        memories: [{ must: [['5,000', '5000']] }, { must: [['dad', 'robert']] }],
      },
      'Robert',
    ),
  ],
  '2023-03-02': [
    fact('money', 'Bought a used Subaru for $14,500, the first car payment starts in April.', {
      entities: [{ name: 'Subaru', type: 'product' }],
      relations: [{ subject: 'user', object: 'Subaru' }],
      memories: [{ must: ['subaru'] }, { must: [['14,500', '14500']] }],
    }),
  ],
  '2023-06-18': [
    tripFact('Lisbon', 'Dev', 'Got back from Lisbon with Dev, we ate far too many pasteis.'),
  ],
  '2024-01-15': [
    fact('health', 'Dr. Okafor says I have type 2 diabetes, so we are starting metformin.', {
      entities: [
        { name: 'Dr. Okafor', type: 'person' },
        { name: 'type 2 diabetes', type: 'condition' },
      ],
      relations: [
        { subject: 'user', object: 'Dr. Okafor', symmetric: true },
        { subject: 'user', object: 'type 2 diabetes' },
      ],
      memories: [{ must: ['diabetes'] }, { must: ['metformin'] }],
    }),
  ],
  '2024-02-10': [
    fact(
      'people',
      'Maya and I decided to separate, and we are co-parenting Leo really well.',
      {
        entities: [
          { name: 'Maya', type: 'person' },
          { name: 'Leo', type: 'person' },
        ],
        relations: [
          { subject: 'user', object: 'Maya', symmetric: true },
          { subject: 'user', object: 'Leo', symmetric: true },
        ],
        memories: [
          { must: ['maya'] },
          { must: [['separat', 'split', 'apart']] },
          { must: ['leo'] },
        ],
      },
      'Maya',
    ),
  ],
  '2024-02-20': [
    tripFact('Tahoe', 'Leo', 'Tahoe with Leo for the weekend, he finally nailed the black run.'),
  ],
  '2024-06-10': [
    fact(
      'people',
      'Nora was born this morning, seven pounds two ounces, and everyone is exhausted.',
      {
        entities: [{ name: 'Nora', type: 'person' }],
        relations: [{ subject: 'user', object: 'Nora', symmetric: true }],
        memories: [{ must: ['nora'] }, { must: [['born', 'birth']] }],
      },
      'Nora',
    ),
  ],
  '2024-06-20': [
    fact('career', 'I left Brightline last Friday, my last day was a bittersweet mess.', {
      entities: [{ name: 'Brightline', type: 'organization' }],
      relations: [{ subject: 'user', object: 'Brightline', symmetric: true }],
      memories: [
        { must: ['brightline'] },
        { must: [['left', 'leav', 'quit', 'last day', 'ended']] },
      ],
      forbiddenMemories: [
        {
          must: ['brightline', ['works at', 'working at', 'currently at', 'employed at']],
          modality: ['stated'],
        },
      ],
    }),
  ],
  '2024-07-05': [
    fact('career', 'I got promoted to senior product manager at Northwind, still processing it.', {
      entities: [{ name: 'Northwind', type: 'organization' }],
      relations: [{ subject: 'user', object: 'Northwind', symmetric: true }],
      memories: [{ must: ['northwind'] }, { must: [['promot', 'senior']] }],
    }),
  ],
  '2024-10-06': [
    fact('goals', 'I finished my first half marathon today, legs are jelly.', {
      entities: [{ name: 'half marathon', type: 'event' }],
      relations: [{ subject: 'user', object: 'half marathon' }],
      memories: [{ must: [['half marathon', 'half-marathon']] }],
    }),
  ],
  '2025-02-10': [
    fact('health', 'Dr. Patel says my blood pressure is high, so I am cutting back on salt.', {
      entities: [
        { name: 'Dr. Patel', type: 'person' },
        { name: 'blood pressure', type: 'condition', aliases: ['high blood pressure'] },
      ],
      relations: [
        { subject: 'user', object: 'Dr. Patel', symmetric: true },
        { subject: 'user', object: 'blood pressure' },
      ],
      memories: [
        { must: [['blood pressure', 'hypertens']] },
        { must: [['lisinopril', 'salt', 'sodium']] },
      ],
    }),
  ],
  '2025-06-01': [
    fact('places', 'We moved to Portland this week, the rain is already growing on me.', {
      entities: [{ name: 'Portland', type: 'place' }],
      relations: [{ subject: 'user', object: 'Portland' }],
      memories: [{ must: ['portland'] }, { must: [['moved', 'move']] }],
    }),
  ],
  '2025-08-15': [
    fact('trips', 'Got back from Reykjavik, solo trip, the northern lights were worth the cold.', {
      entities: [{ name: 'Reykjavik', type: 'place' }],
      relations: [{ subject: 'user', object: 'Reykjavik' }],
      memories: [{ must: ['reykjavik'] }],
    }),
  ],
  '2025-09-01': [
    fact('health', 'I stopped taking metformin in September after the new diet, doctor is happy.', {
      entities: [{ name: 'metformin', type: 'medication' }],
      relations: [{ subject: 'user', object: 'metformin' }],
      memories: [{ must: ['metformin'] }, { must: [['stop', 'quit', 'no longer']] }],
      forbiddenMemories: [
        {
          must: ['metformin', ['takes ', 'take every', 'every morning', 'daily']],
          modality: ['stated'],
        },
      ],
    }),
  ],
  '2026-02-14': [
    fact('emotions', 'Dad passed away this morning. I keep reaching for my phone to call him.', {
      entities: [{ name: 'Robert', type: 'person', aliases: ['Dad'] }],
      relations: [{ subject: 'user', object: 'Robert', symmetric: true }],
      memories: [
        { must: [['robert', 'dad']] },
        { must: [['passed away', 'died', 'death', 'passed']] },
      ],
    }),
  ],
  '2026-03-08': [
    tripFact(
      'Mexico City',
      'Theo',
      'Mexico City with Theo was the reset I needed, tacos every day.',
    ),
  ],
};

// ── Timeline ──────────────────────────────────────────────────────────────

function* eachDay(start: string, end: string): Generator<string> {
  const d = new Date(`${start}T00:00:00Z`);
  const last = new Date(`${end}T00:00:00Z`).getTime();
  while (d.getTime() <= last) {
    yield d.toISOString().slice(0, 10);
    d.setUTCDate(d.getUTCDate() + 1);
  }
}

function drawFact(c: Ctx): Fact {
  for (let i = 0; i < 50; i++) {
    const f = pick(c.rng, MAKERS)(c);
    if (f) return f;
  }
  throw new Error(`no maker applied on ${c.date}`);
}

/** Applies one hard feature to the day's facts. Returns false when it can't apply. */
function applyHard(kind: HardFeature, c: Ctx, facts: Fact[]): boolean {
  switch (kind) {
    case 'pronoun':
      facts.push(kinMove(c));
      return true;
    case 'negation':
      facts.push(negationFact(c));
      return true;
    case 'hypothetical':
      facts.push(hypoFact(c));
      return true;
    case 'attribution':
      facts.push(attributionFact(c));
      return true;
    case 'correction': {
      const i = facts.findIndex((f) => f.person);
      if (i < 0) return false;
      const target = facts[i]!;
      const wrong = pick(
        c.rng,
        WRONG_NAMES.filter((w) => w !== target.person),
      );
      facts[i] = {
        ...target,
        text: `Scratch that, I meant ${target.person}, not ${wrong}. ${target.text}`,
        // The retracted name is a real mention, so it's an entity. What's forbidden
        // is the relation to the user; the correct name keeps the real relation.
        gold: {
          ...target.gold,
          entities: [...target.gold.entities, { name: wrong, type: 'person' }],
          forbiddenRelations: [
            ...target.gold.forbiddenRelations,
            { subject: 'user', object: wrong },
          ],
        },
      };
      return true;
    }
  }
}

/** Builds the full timeline, one entry per day that has one. Deterministic per seed. */
export function buildTimeline(seed = 20261108): Entry[] {
  const rng = mulberry32(seed);
  const entries: Entry[] = [];
  for (const date of eachDay(START, END)) {
    const life = lifeOn(date);
    const forced = FORCED[date] ?? [];
    if (forced.length === 0 && rng() >= 0.45) continue;

    const c: Ctx = { rng, date, life };
    const facts: Fact[] = [...forced];
    const extra = rng() < 0.55 ? 1 : rng() < 0.7 ? 2 : 3;
    for (let i = 0; i < extra; i++) facts.push(drawFact(c));

    const hard: HardFeature[] = [];
    if (rng() < 0.35) {
      const kind = pick(rng, HARD_FEATURES);
      if (applyHard(kind, c, facts)) hard.push(kind);
    }

    const domains = [...new Set(facts.map((f) => f.domain))];
    entries.push({
      date,
      year: Number(date.slice(0, 4)),
      text: facts.map((f) => f.text).join(' '),
      domains,
      hard,
      gold: mergeGold(facts.map((f) => f.gold)),
    });
  }
  return entries;
}

export interface TimelineStats {
  entries: number;
  goldMemories: number;
  byYear: Record<number, number>;
  byDomain: Record<string, number>;
  byHard: Record<string, number>;
}

export function timelineStats(entries: Entry[]): TimelineStats {
  const stats: TimelineStats = {
    entries: entries.length,
    goldMemories: 0,
    byYear: {},
    byDomain: {},
    byHard: {},
  };
  for (const e of entries) {
    stats.byYear[e.year] = (stats.byYear[e.year] ?? 0) + 1;
    for (const d of e.domains) stats.byDomain[d] = (stats.byDomain[d] ?? 0) + 1;
    for (const h of e.hard) stats.byHard[h] = (stats.byHard[h] ?? 0) + 1;
    stats.goldMemories += e.gold.memories.length;
  }
  return stats;
}
