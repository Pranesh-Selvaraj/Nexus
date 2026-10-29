# Mission and ambition

Nexus exists to make learning anything as effective as working with a great tutor who has read everything you have — grounded in your own material, built around practice rather than passive reading, and running on infrastructure you control.

This document is the long-form statement of why Nexus exists, what it is trying to become, the principles that constrain how it grows, and how every feature is supposed to improve learning. It separates what ships today from what is ambition, so roadmap items are not mistaken for current behaviour.

## The mission

**Help people turn anything they can read, watch, listen to or photograph into knowledge they can use, remember and build on — with an AI tutor that stays grounded in their sources and a practice loop that makes retention measurable.**

The unit of the product is not a document, a chat or a flashcard. It is a **topic the learner is trying to master**, and everything in Nexus exists to move that topic from "I have the material" to "I can explain and use it".

## The problem Nexus is answering

- **Consumption is not learning.** Reading a book, watching a lecture or saving an article feels productive, but without retrieval, feedback and spacing most of it is forgotten. The tools around those sources rarely connect reading to practice.
- **Learning material is scattered.** A learner's knowledge lives in PDFs, slides, recorded lectures, web articles, screenshots, notes and photos of whiteboards. Generic assistants cannot see all of it and do not preserve where an answer came from.
- **Generic AI is confidently unreliable.** A chat model without retrieval will answer from parametric memory, invent sources and cannot say "your material does not cover this". For learning, a confident hallucination is worse than an honest gap.
- **Study tools are disconnected from sources.** Flashcard apps, quiz generators and note tools usually hold content that is copied away from the book, lecture or article it came from, so provenance and updates are lost.
- **Learning data is someone else's asset.** Most study platforms are closed services that own the learner's data, telemetry and progress. Self-hosted learners have no equivalent that combines ingestion, grounded tutoring and spaced practice.
- **Practice is hard to design.** Making good questions, drills and review schedules is a skill; most learners do not have the time or the training to build them from their own material.

## The ambition: an ultimate learning portal

"Ultimate" here is a direction, not a claim. The ambition is for Nexus to be the single place where a motivated learner can:

1. **Bring any source** — a book, a course, slides, a lecture recording, a web page, a YouTube talk, a photographed diagram, a paper, their own notes — and have it understood, structured and searchable in minutes.
2. **Understand it with a tutor that can only use their material** — asking questions that cite the exact passage, image or timestamp, and getting an honest "not in your sources" when the material does not contain the answer.
3. **Practise deliberately** — flashcards, quizzes, dictation, pronunciation, teach-back and generative exercises built from the same sources, not from generic content.
4. **Retain it** — spaced repetition scheduling every card at the moment it is about to be forgotten, with progress that reflects real retention rather than streaks.
5. **See the learning curve** — a dashboard that shows what is due, what is weak, what was reviewed, and where the learner is on a real proficiency scale.
6. **Own everything** — self-hosted, exportable, scriptable through a scoped API/MCP, and usable offline when the network is gone.

The measure of success is not "more features". It is **more learning per hour spent**: does the learner reach a correct, sourced answer faster; do they remember it a week later; can they apply it in a new situation; and can they do all of that without surrendering their data?

## Product principles

1. **Grounded before generative.** Answers must be built from retrieved sources and cite them. When sources are insufficient, the correct behaviour is to say so and point at what might help — never to fill the gap with confident invention.
2. **Active over passive.** Every reading surface should lead to a retrieval action: a question, a card, a quiz, a dictation, a teach-back. Features that only display content are incomplete until they connect to practice.
3. **One topic, many inputs.** The learner should not care whether knowledge came from a PDF, a lecture, a web page or a painting. A topic unifies formats, provenance and practice.
4. **Practice is first-class.** Flashcards, quizzes, drills and review are not add-ons to chat; they are the mechanism by which understanding becomes retention.
5. **Explainable by default.** Retrieval shows its candidates and scores, answers show token usage and timings, documents show how they were parsed, and progress shows its inputs. A learner should be able to ask "why did the system say that?" and get an answer.
6. **Own your data, own your stack.** Self-hosting is a product feature: export everything, run without a vendor, use any OpenAI-compatible provider, and keep the API open enough that leaving is always possible.
7. **Respect attention and accessibility.** No dark patterns, no engagement streaks that reward presence over learning, keyboard and mobile parity, and a design that works for long reading sessions.

## How learning science maps to the product

Nexus is not a cognitive-science experiment, but its mechanisms are chosen deliberately:

- **Retrieval practice (the testing effect).** Recalling an answer strengthens memory more than rereading it. Nexus turns sources into questions (quizzes, flashcards, teach-back prompts) and makes recall the primary interaction.
- **Spaced repetition.** Reviewing at expanding intervals fights the forgetting curve. Flashcards are scheduled with FSRS (stability, difficulty, lapses and learning steps), with interval previews before each rating.
- **Immediate feedback.** Errors corrected at the moment they happen are more useful than delayed correction. Dictation shows a word-level diff, pronunciation shows per-word alignment, quizzes mark answers and collect mistakes.
- **Elaboration and connection.** Explaining and connecting ideas deepens understanding. Personas (Socratic tutor, explainer, exam coach, art critic, code mentor...) change the kind of explanation and questioning, and packs connect a plan across sessions.
- **Interleaving and mixed practice.** Quizzes and reviews mix cards and topics rather than blocking one skill, and the dashboard surfaces what is due across topics.
- **Dual coding.** Text and images are processed differently; vision chat and image citations let diagrams, artworks and photographed pages participate in the same retrieval loop as text.
- **Metacognition.** Learners need to know what they know. Due counts, review history, quiz results and CEFR estimates make the state of knowledge visible instead of guessed.
- **Desirable difficulty.** Generation (answering before being told), spacing and mixed practice feel harder but produce better retention. The product favours those over passive summaries, while keeping the difficulty adjustable through review ratings.
- **Teach-back / Feynman technique.** Explaining a concept in your own words exposes gaps. The tutor can grade an explanation against the sources and list what is missing (the ambition is tracked in the backlog).

## The learner loop

1. **Choose a topic.** Create a subject with an optional goal, or install a pack that provides a plan, starter questions and a deck.
2. **Bring sources.** Upload files, import an article or YouTube transcript, photograph a page, record a lecture, or add notes. Everything is parsed, chunked, embedded and indexed asynchronously.
3. **Understand.** Ask grounded questions, inspect the cited sources and the retrieval candidates, attach images, or switch to a Socratic/explainer persona.
4. **Practise.** Generate flashcards, take a quiz, mine vocabulary, dictate a sentence, record a pronunciation attempt, or work through the pack plan.
5. **Retain.** Review due cards with spaced repetition; the dashboard and topic badges show what is due and what was reviewed.
6. **Measure.** Quiz accuracy, review history, CEFR estimates and activity per topic show whether the material is sticking.
7. **Keep or leave.** Export the topic as a zip or JSON, share a read-only link, invite members with roles, or query everything through the API, MCP server or CLI.

## Feature map: what each part is for

| Area                                                                                                           | What it does                                                                        | Learning mechanism                                                                                            |
| -------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Ingestion (PDF, EPUB, slides, sheets, HTML, ZIP, subtitles, audio/video, images, scanned pages, URLs, YouTube) | Turns any source into structured, searchable chunks with provenance                 | Removes the "material is scattered" barrier; structure preserves chapters, pages and timestamps for citations |
| Hybrid retrieval (vector + keyword, HNSW at scale)                                                             | Finds the passages that matter, including semantic-only matches                     | Grounds the tutor in evidence; exact terms (names, formulas, code) survive tokenisation                       |
| Grounded chat with citations and an inspector                                                                  | Answers from retrieved sources; shows candidates, scores and timings                | Retrieval practice with feedback; explainability builds trust and lets the learner audit the evidence         |
| Vision chat and image analysis                                                                                 | Discusses diagrams, artworks and photographed pages; cites the image                | Dual coding; art critique/diagram/equation modes are domain-specific elaboration                              |
| Personas and modes                                                                                             | Socratic, explainer, exam coach, art critic, code mentor, language partner...       | Elaboration, different levels of desirable difficulty, teach-back prompts                                     |
| Flashcards + FSRS                                                                                              | Cards from documents, selections or packs; scheduled reviews with interval previews | Spaced repetition and retrieval practice, the strongest retention levers                                      |
| Quizzes                                                                                                        | Generated questions with grading, results and a mistake notebook                    | Retrieval practice with immediate feedback and metacognition                                                  |
| Dictation + pronunciation + vocabulary                                                                         | Listening and speaking drills with word-level diffs and scores                      | Immediate feedback on productive skills; vocabulary mining feeds spaced repetition                            |
| CEFR and progress                                                                                              | Per-skill estimates and activity history                                            | Metacognition and goal tracking; makes the learning curve visible                                             |
| Domain packs                                                                                                   | A persona, plan, starter questions and deck for a domain                            | Reduces cold-start friction; gives a scaffolded curriculum from the first minute                              |
| Dashboard and topics                                                                                           | Cross-topic due work, reviews, recent sources, suggested next steps                 | Planning, interleaving and habit; answers "what should I do now?"                                             |
| Offline PWA                                                                                                    | Cached shell and speech, offline review queue                                       | Practice continues when the network does not; reduces friction                                                |
| Sharing and roles                                                                                              | Read-only capability links; memberships with reader/editor/owner                    | Learning is social; a study group can share sources and progress safely                                       |
| REST API, MCP, CLI, webhooks                                                                                   | Scoped programmatic access to search, ask, upload, review                           | Automates the loop and lets other tools (notes, editors, agents) feed it                                      |
| Backups, exports, S3 storage                                                                                   | Portable data and self-hosted durability                                            | Ownership and trust; a learner can leave with their material                                                  |
| Observability and queue admin                                                                                  | Request ids, metrics, job retry/drop                                                | Operability, so the learning loop stays reliable under load                                                   |

## Who Nexus is for

- **Students** turning lecture slides, textbooks and recordings into review material for exams.
- **Professionals** upskilling from papers, documentation, courses and conference talks.
- **Language learners** combining reading, dictation, pronunciation and vocabulary in one topic.
- **Artists and designers** studying composition, technique and art history from images and texts.
- **Lifelong learners** who collect books, articles and notes and want them to become usable knowledge.
- **Teachers and tutors** assembling a topic with sources, a plan, cards and quizzes for learners.
- **Self-hosters and privacy-conscious learners** who want the capability without a closed SaaS.
- **Developers and agents** who want a knowledge base they can query through an API or MCP.

## What "ultimate" means in measurable terms

These are success criteria, not promises or dates. They exist so the roadmap can be judged against learning outcomes rather than feature count.

- **Activation:** a new user reaches a first grounded, cited answer and a first review within one session; a pack or a single upload is enough to get there.
- **Habit and retention:** spaced reviews continue after the first week; the product reports real retention (review history and ratings) rather than presence streaks.
- **Mastery:** quiz accuracy and CEFR estimates improve over time on the same material; the mistake notebook shows gaps closing.
- **Trust:** answers cite sources that support their claims; unsupported questions are answered with an explicit gap, not invention; the retrieval inspector explains why sources were chosen.
- **Coverage:** any common learning source — text, slides, books, web, video, audio, images — can enter the loop without a separate tool.
- **Performance:** the documented envelope (HNSW retrieval, queue-based indexing, measured load-test numbers) keeps interaction latency low as corpora grow.
- **Portability:** a learner can leave with their documents, conversations, cards and notes in open formats at any time.
- **Privacy and ownership:** self-hosted by default, no third-party analytics required, provider credentials under the deployment's control, scoped sharing instead of public-by-default.
- **Accessibility and reach:** keyboard and mobile parity, offline review, and (roadmap) internationalisation with a validated RTL layout.

## Today versus ambition

Shipped today (see the README and CHANGELOG for detail): ingestion across documents, books, web, YouTube, audio/video and images/OCR; grounded chat with citations and an inspector; vision chat; personas; flashcards with FSRS; quizzes; dictation, pronunciation, vocabulary and CEFR; domain packs; the learning-portal dashboard and topics; offline review; memberships and roles; read-only share links; REST API, MCP, CLI and webhooks; S3 storage, backups, exports; HNSW retrieval and the load-test envelope.

Ambition tracked as issues (not current behaviour): comments and an audit log (#102), email invitations (#103), per-member study state (#104), i18n/RTL (#105), deep links and a library mode (#106), user-authored/versioned packs (#107), S3 migration and orphan cleanup (#108), Helm/TLS deployment (#109), OpenTelemetry/Sentry reporting (#86), teach-back grading, and teach-back grading (#111).

The roadmap lives in GitHub Issues. It is criteria-driven; there are no dates or duration estimates.

## Non-goals

Nexus is not trying to be:

- **An accredited school or a credential issuer.** It can support exam preparation, but it does not award degrees or certify competence.
- **A social network or a content marketplace.** Sharing exists to support a study group, not to maximise engagement or distribute proprietary courses.
- **A surveillance product.** Learning analytics exist to help the learner, not to profile them; no third-party tracking is required.
- **A DRM or paywall system.** It assumes the learner has the right to use the material they ingest.
- **A replacement for a teacher.** It is a tutor and practice environment; human guidance, feedback and community remain valuable.
- **A generic chatbot.** Answers are deliberately constrained to the learner's sources and to learning tasks.

## How the architecture serves the mission

- **Retrieval is the boundary.** The model only sees retrieved chunks (with citations), which is what makes "grounded" enforceable rather than aspirational. Chunk provenance, hybrid search and the inspector exist for trust and debuggability.
- **Asynchronous ingestion keeps the loop fast.** Parsing, OCR, transcription and embedding run in a queue, so a large upload does not block asking questions about what is already indexed.
- **Everything is a topic.** Documents, conversations, decks, quizzes, notes and packs hang off one workspace, so practice, chat and progress share the same scope and permissions.
- **Self-hosting is not an afterthought.** Local or S3 storage, any OpenAI-compatible provider, optional local models and Whisper, Postgres + pgvector and Redis only — the stack is deliberately small enough for one person to run.
- **The API is the same surface as the UI.** Scoped keys, REST, MCP and the CLI use the same retrieval and permissions, so automation cannot bypass the learning or security model.
- **Boring, tested operations.** Migrations, backups with a restore drill, metrics and queue admin exist because a learning habit depends on the tool being available and trustworthy.

## Governance and how to contribute

Nexus is MIT-licensed and developed in the open. Significant technical decisions are recorded as ADRs in `docs/decisions/`; releases carry detailed changelogs in `CHANGELOG.md`; defects, feature requests and deferred work are tracked in GitHub Issues. Contributions should keep the mission in view: a change that adds capability without improving the learner's understanding, retention or trust is not finished.

Start with [CONTRIBUTING.md](../CONTRIBUTING.md), the [README](../README.md), the [decisions](decisions/) and the [issue tracker](https://github.com/Pranesh-Selvaraj/Nexus/issues).

## Reading list

- [README](../README.md) — what the product does today, how to run it and how to use it.
- [CHANGELOG](../CHANGELOG.md) — release-by-release history, including fixes and deliberate omissions.
- [Architecture decision records](decisions/) — why ingestion, retrieval, storage and the learning-portal shell are built the way they are.
- [GitHub Issues](https://github.com/Pranesh-Selvaraj/Nexus/issues) — bugs, feature requests and the roadmap.
