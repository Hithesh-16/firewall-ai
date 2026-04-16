# Product Naming — AI Firewall

Working document for choosing the brand name as the product moves from
open-source release to enterprise edition. Same brand both tiers, suffix
the paid edition (`<Name>` / `<Name> Cloud` / `<Name> Enterprise`) — same
playbook as HashiCorp Vault, Grafana, Sentry, GitLab.

> **Why drop "AI Firewall" as a product name:** it's a category
> description, not a brand. Categories date you and let competitors
> define your space. Same reason Anthropic isn't called "AI Assistant"
> and HashiCorp's product isn't called "Secret Vault."

---

## Comparison — every name considered

Scoring is 1-10 across each criterion. **Total** is just an at-a-glance
average; taste matters more than arithmetic.

| Name          | Meaning / metaphor                     | Collision risk                                              | Enterprise feel                 | Easy to say         | Domain availability\* | Total   |
| ------------- | -------------------------------------- | ----------------------------------------------------------- | ------------------------------- | ------------------- | --------------------- | ------- |
| **Castellan** | Keeper of the castle gate              | Low (small music label, no SaaS)                            | 9 — sounds CISO-buyable         | 8                   | High                  | **8.5** |
| **Tollgate**  | Gateway with mandatory toll (the scan) | Low                                                         | 7 — friendlier, less gravitas   | 9                   | High (.dev/.io)       | **8.0** |
| **Foyer**     | Sophisticated entry hall               | Very low in tech                                            | 8                               | 9                   | High                  | **7.7** |
| **Aegis**     | Athena's shield                        | Medium (Aegis Authenticator, several others)                | 9                               | 9                   | Low (.com taken)      | **7.0** |
| **Pylon**     | Gateway pillars (Egyptian temples)     | Low-med (Pylon ETL exists)                                  | 7                               | 9                   | Medium                | **6.8** |
| **Argus**     | Hundred-eyed watchman                  | Medium (Argus Media, Argus Insurance)                       | 8                               | 8                   | Low                   | **6.5** |
| **Janus**     | Two-faced gateway god                  | Medium (Janus security project, Janus DRM)                  | 8                               | 8                   | Low                   | **6.3** |
| **Bevel**     | Angled, finished edge                  | Low                                                         | 6                               | 9                   | Medium                | **6.3** |
| **Sluice**    | Channel that controls water flow       | Very low                                                    | 7                               | 6 — spelling tricky | High                  | **6.2** |
| **Causeway**  | Raised path through hostile terrain    | Low                                                         | 6                               | 8                   | High                  | **6.0** |
| **Bastion**   | Fortified position                     | High (Bastion host is a generic security term, AWS uses it) | 8                               | 9                   | Low                   | **5.8** |
| **Threshold** | Boundary every request crosses         | High (Threshold Network crypto, dance, others)              | 7                               | 7                   | Low                   | **5.5** |
| **Bouncer**   | Gatekeeper at the door                 | Low                                                         | 4 — too informal for enterprise | 9                   | High                  | **5.0** |

\*Domain availability is a guess based on category prevalence — verify
before committing.

**Ranking from this list: Castellan > Tollgate > Foyer > Aegis.** The
first three score high on uniqueness, which matters more than meaning —
meaning is what marketing builds, uniqueness is what saves you from
rebranding in two years.

---

## Hike / Hikee / Keehi — sound-family options

Short, soft, two-syllable, vowel-led — same family as Stripe, Plaid,
Loom, Linear, Reka, Notion, Vercel, Cohere, Glean. Brandable nonsense
words that grow meaning over time. The strongest set in that sound
family that _also_ has a real protective/gateway hook:

| Name       | What it is                                                                | Why it works                                                                                                                                                                          | Caveat                                                                                                                    |
| ---------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| **Heka**   | Egyptian god of magic — _the spoken word that wards_. Pronounced HEH-kah. | Perfect product fit (you protect every word the user "speaks" to an LLM). Distinctive, two syllables, easy globally. `heka.dev` / `heka.ai` likely free. Sound family matches "hike". | Niche reference — not everyone will know the etymology. That's actually fine; nobody knew "Stripe" meant anything either. |
| **Hike**   | "We hike alongside your AI." Friendly, action-word brand.                 | One syllable, instantly understood, friendly enterprise (think Notion's tone).                                                                                                        | `hike.com` is taken (defunct Indian messenger). `hike.dev` / `hike.security` may still be open.                           |
| **Hikari** | Japanese for _light_ / _to shine through_. HEE-kar-ee.                    | Three syllables but musical. Strong "see what's hidden" metaphor — fits a scanner. Distinctive globally.                                                                              | Slight anime/aesthetic association in the West.                                                                           |
| **Kove**   | Invented spelling of _cove_ — a protected harbor.                         | One syllable, premium brand feel (Vercel-adjacent). Enterprise-credible.                                                                                                              | `cove.io` is taken (real estate); `kove.com` is taken (storage company). May force `.dev` / `.security`.                  |
| **Keep**   | The innermost stronghold of a castle — the part that never falls.         | One syllable, instantly understood, strong product fit.                                                                                                                               | Generic word; will be a domain fight.                                                                                     |
| **Hyke**   | Stylized "hike" with a Y — invented enough to be claimable.               | Same friendly hike vibe but uniquely yours; better domain odds.                                                                                                                       | Slight "trying too hard" risk.                                                                                            |

**Pick from this family: Heka.** Hits every box — short, soft, two
syllables, real meaning that maps 1:1 to the product, distinctive in the
AI-security space, almost certainly clear on domains and trademarks, and
works in copy: _"Heka scanned 14 leaks today."_ / _"Heka Cloud"_ /
_"Heka Enterprise"_.

---

## Final shortlist (rank order)

1. **Heka** — best brandable invented-feel option; perfect protective metaphor
2. **Castellan** — best enterprise-gravitas option; immediately credible to a CISO
3. **Tollgate** — best on-the-nose / developer-friendly option

Pick one based on the audience you most need to win on day one:

- Selling to **CISOs, security buyers, regulated industries** → _Castellan_
- Selling to **engineers, OSS users, developer tools market** → _Heka_ or _Tollgate_

---

## OSS → Enterprise naming pattern

Use the proven HashiCorp / Grafana / Sentry playbook — same brand both
tiers, suffix only the paid edition:

| Tier                          | Naming              | Example call sites                      |
| ----------------------------- | ------------------- | --------------------------------------- |
| Open source, self-hosted      | `<Name>`            | the repo, the binary, the CLI, the docs |
| Managed SaaS                  | `<Name> Cloud`      | for teams who don't want to host        |
| Self-hosted with SSO/RBAC/SLA | `<Name> Enterprise` | with support contract                   |

Concretely with the top pick:

- `Heka` — open-source, self-hosted (the repo, the binary, the docs)
- `Heka Cloud` — managed SaaS for teams who don't want to host
- `Heka Enterprise` — self-hosted with SSO, RBAC, SLA, support contract

> **Don't** invent a separate brand for the paid tier. It splits the
> audience, dilutes SEO, and makes "upgrade" feel like leaving the
> product instead of unlocking more of it.

---

## Pre-commit checklist

Before locking in any name:

1. **Trademark search** — USPTO TESS for software/security classes (009, 042). Also EUIPO if Europe matters.
2. **Domain check** — `.dev`, `.io`, `.com`, `.security`, `.ai`. If `.com` is parked, factor cost.
3. **NPM / GitHub org** — `@<name>` package scope and `<name>-dev` org availability.
4. **Competitor scan** — Google `<name> AI` / `<name> security` to confirm no stealth startup is sitting on it.
5. **Pronunciation test** — say it out loud on a sales call, on a podcast, in a 30-second elevator pitch. Does it survive?
6. **Vibe test in copy** — write three real sentences:
   - _"`<Name>` blocked 14 leaks today."_
   - _"Powered by `<Name>` Enterprise."_
   - _"Install `<name>` from npm."_

---

## Competitive namespace (avoid colliding with these)

Existing AI-security plays already in market — pick a name that does
_not_ sound like one of these:

- Lakera (Lakera Guard)
- Protect AI
- HiddenLayer
- Robust Intelligence
- WhyLabs
- Prompt Security
- Vigil
- Guardrails AI
- Lasso Security
- Calypso AI
- Operant AI
- AIM Security

The space is crowded — distinctiveness is more valuable than descriptiveness.
