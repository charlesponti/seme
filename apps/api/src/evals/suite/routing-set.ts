// Labeled routing set: which skill modules should load for a message.
// Written separately from dataset.ts so the routing threshold has a real holdout.
// Each class has 12 dev and 12 test utterances. Dev tunes the floor and topK;
// test is reported once. An empty `expect` means no module should load.

export interface RoutingCase {
  text: string;
  expect: string[];
  split: 'dev' | 'test';
}

const FOOD = 'food-and-health';
const PEOPLE = 'people-and-relationships';
const WORK = 'work-and-projects';

export const ROUTING_CASES: RoutingCase[] = [
  // ── food-and-health ──
  { text: "I can't eat anything with gluten these days.", expect: [FOOD], split: 'dev' },
  { text: 'My daughter has a severe reaction to tree nuts.', expect: [FOOD], split: 'dev' },
  { text: 'I take metformin every evening.', expect: [FOOD], split: 'dev' },
  { text: "Cutting out sugar has been hard but I'm managing.", expect: [FOOD], split: 'dev' },
  { text: "I'm vegetarian, so no meat at the restaurant.", expect: [FOOD], split: 'dev' },
  {
    text: 'The asthma inhaler is in my bag, I use it in the mornings.',
    expect: [FOOD],
    split: 'dev',
  },
  { text: 'I had sushi and miso soup for lunch.', expect: [FOOD], split: 'dev' },
  { text: 'Tomatoes make my throat itch.', expect: [FOOD], split: 'dev' },
  { text: "My blood pressure is high, so I'm watching salt.", expect: [FOOD], split: 'dev' },
  { text: 'We are making a lentil curry with coconut milk tonight.', expect: [FOOD], split: 'dev' },
  { text: 'I drink two cups of green tea before work.', expect: [FOOD], split: 'dev' },
  { text: 'Doctor says I have type 2 diabetes.', expect: [FOOD], split: 'dev' },
  {
    text: 'Shellfish is off the table for me after the reaction last year.',
    expect: [FOOD],
    split: 'test',
  },
  { text: "I've been taking ibuprofen for the back pain.", expect: [FOOD], split: 'test' },
  { text: 'Could you suggest a dairy-free dessert?', expect: [FOOD], split: 'test' },
  { text: 'We ordered pad thai and spring rolls.', expect: [FOOD], split: 'test' },
  { text: 'My celiac diagnosis changed how I shop.', expect: [FOOD], split: 'test' },
  { text: "I'm lactose intolerant, so oat milk for coffee.", expect: [FOOD], split: 'test' },
  { text: 'She is on antibiotics for an ear infection.', expect: [FOOD], split: 'test' },
  { text: 'Strawberries give my son a rash.', expect: [FOOD], split: 'test' },
  { text: "I've been eating more fiber and less red meat.", expect: [FOOD], split: 'test' },
  { text: 'The kids want pizza again for dinner.', expect: [FOOD], split: 'test' },
  { text: 'I was diagnosed with hypothyroidism in the spring.', expect: [FOOD], split: 'test' },
  { text: 'A glass of wine with dinner is my usual.', expect: [FOOD], split: 'test' },

  // ── people-and-relationships ──
  { text: 'My brother Tom is visiting next week.', expect: [PEOPLE], split: 'dev' },
  { text: 'My partner and I are moving in together.', expect: [PEOPLE], split: 'dev' },
  { text: 'Her mother lives two streets away.', expect: [PEOPLE], split: 'dev' },
  { text: 'My best friend from college just had a baby.', expect: [PEOPLE], split: 'dev' },
  { text: "I've got a new roommate named Sam.", expect: [PEOPLE], split: 'dev' },
  { text: 'My aunt Lucia raised me after my parents passed.', expect: [PEOPLE], split: 'dev' },
  { text: 'My team lead Ravi gave me great feedback.', expect: [PEOPLE], split: 'dev' },
  { text: 'My ex and I still co-parent really well.', expect: [PEOPLE], split: 'dev' },
  { text: "The neighbor's kids keep playing in our yard.", expect: [PEOPLE], split: 'dev' },
  { text: 'My grandfather taught me to fish.', expect: [PEOPLE], split: 'dev' },
  { text: "I'm meeting my cousin for coffee on Sunday.", expect: [PEOPLE], split: 'dev' },
  { text: "My son's teacher is named Mrs. Garcia.", expect: [PEOPLE], split: 'dev' },
  { text: "My wife's sister is a nurse in Denver.", expect: [PEOPLE], split: 'test' },
  { text: 'I reconnected with an old classmate on LinkedIn.', expect: [PEOPLE], split: 'test' },
  { text: 'My dad and I had a long talk about retirement.', expect: [PEOPLE], split: 'test' },
  { text: 'Our landlord, Mr. Patel, is very responsive.', expect: [PEOPLE], split: 'test' },
  { text: "My girlfriend's parents are coming for dinner.", expect: [PEOPLE], split: 'test' },
  { text: 'My colleague Jun keeps covering my shifts.', expect: [PEOPLE], split: 'test' },
  { text: "I'm godfather to my friend's daughter.", expect: [PEOPLE], split: 'test' },
  { text: 'The couple next door are my closest friends.', expect: [PEOPLE], split: 'test' },
  { text: 'My niece just started college.', expect: [PEOPLE], split: 'test' },
  { text: "I'm not close with my half-brother anymore.", expect: [PEOPLE], split: 'test' },
  { text: 'My mentor introduced me to two investors.', expect: [PEOPLE], split: 'test' },
  { text: "We're hosting my in-laws over Thanksgiving.", expect: [PEOPLE], split: 'test' },

  // ── work-and-projects ──
  { text: 'The quarterly report is due Friday.', expect: [WORK], split: 'dev' },
  { text: "I'm leading the migration to the new billing system.", expect: [WORK], split: 'dev' },
  { text: 'Finance approved another $20k for the campaign.', expect: [WORK], split: 'dev' },
  { text: 'We decided to drop the mobile app for now.', expect: [WORK], split: 'dev' },
  { text: 'I got promoted to senior engineer last month.', expect: [WORK], split: 'dev' },
  { text: 'The board signed off on the hiring plan.', expect: [WORK], split: 'dev' },
  { text: 'My sprint ends on Thursday and we are behind.', expect: [WORK], split: 'dev' },
  { text: 'I own the onboarding flow for new customers.', expect: [WORK], split: 'dev' },
  { text: 'We need a budget revision before the audit.', expect: [WORK], split: 'dev' },
  { text: 'The client rejected our second proposal.', expect: [WORK], split: 'dev' },
  { text: 'Our launch date slipped to March.', expect: [WORK], split: 'dev' },
  { text: "I'm interviewing candidates for the data role.", expect: [WORK], split: 'dev' },
  { text: 'Legal reviewed the contract and approved the terms.', expect: [WORK], split: 'test' },
  { text: "I'm drafting the project roadmap for next year.", expect: [WORK], split: 'test' },
  { text: 'The product team voted to delay the redesign.', expect: [WORK], split: 'test' },
  { text: 'Our vendor invoice is overdue by two weeks.', expect: [WORK], split: 'test' },
  { text: "I'm on call this weekend for the payments service.", expect: [WORK], split: 'test' },
  { text: 'The department cut travel spend by 15 percent.', expect: [WORK], split: 'test' },
  { text: 'Dana signed off on the design review.', expect: [WORK], split: 'test' },
  { text: 'We set Q2 goals during the offsite.', expect: [WORK], split: 'test' },
  { text: 'My deliverable for the grant is due in April.', expect: [WORK], split: 'test' },
  { text: 'The steering committee approved the pilot.', expect: [WORK], split: 'test' },
  { text: "I'm transferring ownership of the reporting dashboard.", expect: [WORK], split: 'test' },
  { text: 'Our team missed the deadline for the release.', expect: [WORK], split: 'test' },

  // ── no module ──
  { text: "Thanks, that's all for now.", expect: [], split: 'dev' },
  { text: "Hi there, how's it going?", expect: [], split: 'dev' },
  { text: "What's the weather like in Oslo tomorrow?", expect: [], split: 'dev' },
  { text: 'Can you remind me what time it is in Tokyo?', expect: [], split: 'dev' },
  { text: 'Ok sounds good.', expect: [], split: 'dev' },
  { text: "I'm reading a good mystery novel.", expect: [], split: 'dev' },
  { text: 'The new album by that band is great.', expect: [], split: 'dev' },
  { text: "I need to renew my driver's license online.", expect: [], split: 'dev' },
  { text: 'My bike has a flat tire.', expect: [], split: 'dev' },
  { text: "I'll think about it and get back to you.", expect: [], split: 'dev' },
  { text: 'Remind me to water the plants later.', expect: [], split: 'dev' },
  { text: 'That movie had a really slow start.', expect: [], split: 'dev' },
  { text: 'Good morning! Ready when you are.', expect: [], split: 'test' },
  { text: 'Can you explain how rainbows form?', expect: [], split: 'test' },
  { text: 'The Wi-Fi keeps dropping in the living room.', expect: [], split: 'test' },
  { text: "I'm planning a trip to Portugal in June.", expect: [], split: 'test' },
  { text: "Haha, that's a great joke.", expect: [], split: 'test' },
  { text: 'How do I change the tire on a bicycle?', expect: [], split: 'test' },
  { text: 'Let me know if you need anything else.', expect: [], split: 'test' },
  { text: 'The sunset tonight looks amazing.', expect: [], split: 'test' },
  { text: 'I would like the lights dimmed to 40 percent.', expect: [], split: 'test' },
  { text: "What's a good book about space exploration?", expect: [], split: 'test' },
  { text: 'Yes, go ahead and close the window.', expect: [], split: 'test' },
  { text: 'The printer is out of paper again.', expect: [], split: 'test' },
];
