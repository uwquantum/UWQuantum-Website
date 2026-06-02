# Waterloo Quantum Club

The official website of the Waterloo Quantum Club at the University of Waterloo.
A student community exploring quantum computing, physics, and emerging
technologies. Built as a static site with a small Supabase backend powering
the weekly *Quantum Channels* game.

Live at [uwquantum.com](https://uwquantum.com).

## What's in here

- **Home page** with about, events, and hiring sections
- **Team page** with executive profiles
- **Hydrogen Orbitals** simulator — an interactive WebGL ray-marching
  visualizer of real hydrogenic wavefunctions
- **Quantum Channels** game — a weekly strategy game where players distribute
  100 quanta across 10 channels and learn a different quantum mechanics
  principle each week
- **Rules document** — typeset LaTeX rules with plain-English explanations
  of the four weekly rules

## Project structure

```
.
├── index.html          Home page
├── game.html           Quantum Channels game page
├── orbitals.html       Hydrogen orbital simulator
├── team.html           Executive team page
├── rules.pdf           Compiled rules document (linked from game page)
├── styles/             CSS files
│   ├── style.css         Site-wide styles
│   └── game.css          Game-page-specific styles
├── scripts/            JavaScript
│   ├── script.js         Shared nav + scroll reveal
│   ├── game.js           Quantum Channels game logic
│   └── orbitals.js       WebGL orbital renderer
├── docs/
│   └── rules.tex         LaTeX source for the rules PDF
├── assets/             Images
└── .gitignore
```

## Running locally

The site is fully static. Any HTTP server will do:

```bash
python3 -m http.server 8080
```

Then open `http://localhost:8080`.

## Quantum Channels — quick overview

Each week, every player distributes 100 quanta across 10 channels. The
players with more quanta in a channel wins it (1 point per channel won).
Then one quantum-mechanics rule kicks in:

1. **Quantum measurement** — the tallest channel collapses to 0
2. **Pauli exclusion** — channels under 15 quanta don't count as
   submissions (no points, can't trigger the rule); if both players
   placed ≥15 in the same channel, both stacks are wiped
3. **Quantum tunneling** — each channel has a 25 percent chance to shift
   its quanta one step to the right
4. **Heisenberg uncertainty** — one random channel per player is shifted
   by a random integer between negative 15 and positive 15

Players also get one Superposition Token per week — a coin flip that grants
either zero or three bonus points. Full rules are in `rules.pdf`.

## Weekly cycle

- Submissions open all week, anytime
- Submissions close every Wednesday at 9 AM
- Matchmaking, resolution, and new rule reveal at Wednesday 7 PM
- Players can resubmit freely until the 9 AM deadline

## Backend

User accounts, submissions, and leaderboard are stored in Supabase. The
weekly resolution and matchmaking is scheduled to run as a Supabase Edge
Function. Credentials are kept out of the repo; see `scripts/game.js` for
where the Supabase client is initialized.

## Rebuilding the rules PDF

```bash
cd docs
pdflatex rules.tex
mv rules.pdf ../rules.pdf
rm rules.aux rules.log rules.out
```

## Deployment

The site is deployed via Cloudflare Pages, auto-building from the `main`
branch. No build step is required.

## Credits

Built by Aairav Kalra and Janindu De Silva. Quantum mechanics interpretations
adapted from standard undergraduate physics references and tailored for
playability.
