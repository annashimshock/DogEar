# DogEar

### AI-powered book discovery

DogEar is a personalized book discovery application built to make finding your next read feel more like a personalized selection than searching a catalog.

Rather than relying on endless search results, DogEar helps readers discover books through curated collections, personalized recommendations, and an interactive swipe-based discovery experience. Readers can build a personal library, track their reading, and have conversations with an AI assistant to find books that match their interests.

**Live Demo:** https://dogear.app.space

**Status:** Developed as a full-stack application using DeepSpace.

---

## Overview

Finding a book worth reading can be surprisingly difficult. Traditional book catalogs offer enormous selections, but often leave readers to do most of the filtering themselves.

DogEar approaches discovery from a different direction: start with the reader, understand their interests, and surface a smaller selection of relevant books.

The application combines persistent reader preferences, interaction history, catalog search, and AI-assisted recommendations to create a more personalized discovery experience.

## Features

### Discover
- Browse curated collections of books.
- Search the Google Books catalog.
- Explore books through a swipe-based interface.
- Like, pass, and undo discovery decisions.
- Open a consistent book-details experience across the application.

### For You
- Receive recommendations informed by reading preferences and previous interactions.
- Request additional recommendation selections.
- Chat with an AI assistant about reading interests and potential books.
- Receive explanations for why particular books were recommended.
- Maintain persistent recommendation conversations.

### My Library
- Save books to a personal reading library.
- Organize books into Want to Read, Currently Reading, and Read.
- Maintain reading progress and preferences across sessions.

### Personalization
- Select preferred genres during onboarding.
- Update discovery preferences later.
- Use saved books and swipe interactions to inform future recommendations.

---

## Technology Stack

| Area | Technology |
| Frontend | React 19, TypeScript, Vite |
| Routing | Generouted |
| Backend | Hono, DeepSpace Worker |
| Authentication | DeepSpace Auth |
| Persistent data | DeepSpace RecordRoom |
| AI | DeepSpace AI |
| Book catalog | Google Books API |
| Styling | CSS, custom design tokens |

## Architecture

DogEar uses a full-stack architecture built around DeepSpace platform primitives.

### Authentication

DeepSpace Auth manages user identity and protected application routes. Authenticated requests are resolved server-side, allowing the application to associate personal data with the correct account.

### Persistent Data and Synchronization

DeepSpace RecordRoom provides persistent, owner-scoped storage and synchronization.

The application uses it to manage:
- Saved books and reading statuses.
- Book likes and passes.
- Discovery preferences.
- AI conversations and message history.

This allows reader preferences and activity to persist across sessions.

### AI Recommendation System

The recommendation system combines AI-assisted interpretation with deterministic application logic.

Rather than allowing an AI model to generate arbitrary book titles or bibliographic information, DogEar uses a grounded recommendation pipeline:

1. Reader preferences and interaction history are assembled into a reader profile.
2. AI interprets the profile and helps generate relevant catalog queries.
3. Google Books supplies the actual candidate book records.
4. Candidates pass publication-eligibility, relevance, and category checks.
5. AI selects and explains recommendations using the retrieved candidates.
6. The application validates the results before displaying them.

This separation keeps recommendations connected to real catalog records while still allowing AI to provide a conversational and personalized experience.

### Book Catalog

Google Books serves as the external source of book metadata, including titles, authors, descriptions, categories, and available publication information.

The application normalizes and filters catalog results before using them in discovery and recommendation features.

---

## Engineering Decisions

### Relevance Over Catalog Breadth

One of the main challenges was the quality of results returned by broad catalog searches.

General queries sometimes returned academic journals, textbooks, reference materials, and other publications that did not fit the intended reading experience.

DogEar uses multi-stage filtering and ranking to prioritize standalone books that match the reader's selected interests. It also uses work-level deduplication to prevent duplicate editions or repeated records from overwhelming discovery.

The tradeoff is that strict filtering can exclude legitimate books when external catalog metadata is incomplete. DogEar prioritizes recommendation relevance and trustworthiness over filling every available result slot.

### Grounded AI Recommendations

AI-generated recommendations can be unreliable when models are allowed to invent bibliographic details.

DogEar separates candidate retrieval from recommendation generation. Google Books provides the source records, while AI helps interpret reader preferences and select from those records. Deterministic validation prevents unsupported recommendations from reaching the interface.

### Persistent Personalization

Reader preferences are more useful when they influence the application beyond a single session.

DogEar stores genre selections, reading activity, and discovery interactions so that recommendations can reflect a reader's evolving interests.

---

## Development and Testing

DogEar was developed using OpenCode as an AI coding agent.

Development involved directing scoped implementation tasks, reviewing generated changes, investigating regressions, refining architecture, and making product and engineering decisions.

Verification included:

- TypeScript type checking.
- ESLint.
- Production builds.
- Unit tests.
- DeepSpace end-to-end tests.

External API availability and quota limits are also considered during testing because Google Books is an external dependency.

---

## Local Development

### Prerequisites

- Node.js
- npm
- A configured DeepSpace developer account
- Access to the required application secrets and external API credentials