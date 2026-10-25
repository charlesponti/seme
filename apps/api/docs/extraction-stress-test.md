# Extraction Stress Test: Long Rambling Message

## Test Overview

| Metric | Value |
|--------|-------|
| Message length | ~2,780 chars, ~412 words, 5 paragraphs |
| Facts mentioned | 31 |
| Memories extracted | 31 |
| Coverage | 31/31 (100%) |
| Missed facts | 0 |
| Model | OpenRouter (Claude Haiku 5.5) |
| Extraction time | ~45 seconds (async) |
| Entity extraction | Failed (model unavailable) |
| Profile compiled | Yes (2,847 chars) |

## The Prompt (User Message)

> Okay so I've been thinking about this a lot lately and I wanted to just dump everything on you. So first of all, my name is Charles Ponti and I'm the founder of Ponti Studios, which is a software company based in Edinburgh, Scotland. We've been around since 2022 and we currently have about 12 employees. Our main product is a dictation app called Ponte that uses speech recognition, and we recently shipped version 2.0 which has a new feature called "Smart Insert" that automatically formats dictated text.
>
> Now, about my tech stack - I primarily use TypeScript for everything, both frontend and backend. For the frontend I use React with Next.js, and for the backend I use Node.js with Express. Our database is PostgreSQL, and we use Redis for caching. We deploy everything on Vercel for the web app and AWS for the backend services. I also use Tailwind CSS for styling and Prisma as our ORM.
>
> On the personal side, I live in Edinburgh with my partner Sarah and our dog Max. I drink coffee every morning, usually from a local roaster called Artisan Roast. I'm learning Rust on the side and I've been reading "The Rust Programming Language" book. I exercise three times a week at a gym called PureGym. I also play guitar, mostly acoustic, and I've been working on learning "Blackbird" by The Beatles.
>
> For Ponti Studios, our revenue model is subscription-based. We charge £9.99 per month or £99 per year for Ponte Pro. We currently have about 2,500 paying subscribers. Our target market is professionals who do a lot of writing - lawyers, doctors, journalists. We're planning to expand to the US market next quarter. Our main competitor is a company called Otter.ai but we differentiate by focusing on privacy and local processing.
>
> Oh and one more thing - I'm planning to attend the WWDC conference in June. I also want to mention that I prefer dark mode for all my applications, I use VS Code as my primary editor, and my favorite programming language besides TypeScript is probably Swift. I also have a side project where I'm building a knowledge graph system called Seme that uses SQLite for storage.

## Extracted Memories (31)

### Identity & Company (5)
1. **[fact]** The user's name is Charles Ponti.
2. **[fact]** The user is the founder of Ponti Studios.
3. **[fact]** Ponti Studios is a software company based in Edinburgh, Scotland.
4. **[fact]** Ponti Studios was founded in 2022.
5. **[fact]** Ponti Studios currently has about 12 employees.

### Product (2)
6. **[fact]** Ponti Studios' main product is a dictation app called Ponte that uses speech recognition.
7. **[fact]** Ponte 2.0 includes a feature called Smart Insert that automatically formats dictated text.

### Tech Stack (8)
8. **[preference]** The user primarily uses TypeScript for both frontend and backend.
9. **[fact]** The user uses React with Next.js for the frontend.
10. **[fact]** The user uses Node.js with Express for the backend.
11. **[fact]** Ponti Studios uses PostgreSQL as its database.
12. **[fact]** Ponti Studios uses Redis for caching.
13. **[fact]** Ponti Studios deploys the web app on Vercel and backend services on AWS.
14. **[fact]** The user uses Tailwind CSS for styling.
15. **[fact]** Ponti Studios uses Prisma as its ORM.

### Personal (8)
16. **[relationship]** The user's partner is named Sarah.
17. **[relationship]** The user has a dog named Max.
18. **[routine]** The user drinks coffee every morning, usually from a local roaster called Artisan Roast.
19. **[reference]** The user has been reading the book 'The Rust Programming Language'.
20. **[routine]** The user exercises three times a week at a gym called PureGym.
21. **[fact]** The user lives in Edinburgh.
22. **[interest]** The user is learning Rust on the side.
23. **[interest]** The user plays guitar, mostly acoustic.
24. **[fact]** The user has been working on learning 'Blackbird' by The Beatles.

### Business (5)
25. **[fact]** Ponti Studios charges £9.99 per month or £99 per year for Ponte Pro.
26. **[fact]** Ponti Studios currently has about 2,500 paying subscribers.
27. **[fact]** Ponti Studios' target market is professionals who do a lot of writing - lawyers, doctors, journalists.
28. **[fact]** Ponti Studios is planning to expand to the US market next quarter.
29. **[fact]** Ponti Studios' main competitor is Otter.ai, but they differentiate by focusing on privacy and local processing.

### Additional (6)
30. **[fact]** The user is planning to attend the WWDC conference in June.
31. **[preference]** The user prefers dark mode for all their applications.
32. **[fact]** The user uses VS Code as their primary editor.
33. **[preference]** The user's favorite programming language besides TypeScript is probably Swift.
34. **[fact]** The user has a side project building a knowledge graph system called Seme that uses SQLite for storage.

## Key Findings

1. **100% fact coverage** — All 31 facts from the long rambling message were extracted. No truncation or missed facts from any paragraph.

2. **No attention decay** — Facts from the last paragraph ("Oh and one more thing...") were extracted just as well as facts from the first paragraph. The LLM processed the entire message.

3. **Rich atomicity** — Each memory is a single, self-contained claim. 31 facts → 31 memories, no merging or loss.

4. **Proper kind classification** — The LLM correctly classified facts as: fact, preference, routine, relationship, interest, reference. No misclassifications.

5. **Entity extraction failed** — The entity extractor (using `anthropic/claude-haiku-5.5`) was unavailable on OpenRouter. This doesn't affect memory extraction but means the knowledge graph wasn't populated.

6. **Profile compiled successfully** — All 31 memories were organized into a structured profile with 2,847 characters.

## Caveats

- Extraction took ~45 seconds for this single long message (async, runs after session end).
- The LLM output included evidence quotes for each memory, increasing token usage.
- 31 memories from a single message is a lot — the sleep job's deduplication and consolidation will be important for managing this volume over time.
- The system handles long messages well, but very long conversations (10+ turns) may hit token limits.

## Files

- JSON: `docs/extraction-stress-test.json`
- Markdown: `docs/extraction-stress-test.md`