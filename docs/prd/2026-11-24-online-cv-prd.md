# PRD: Pulzar CV (the online životopis)

24 Nov 2026 · Draft for the owner · Starting point: `2026-11-24-e-vizitka-and-cv-brief.md`
**Platform:** `2026-11-24-e-vizitka-prd.md` §7.1. PL-1 to PL-18 apply unchanged except where §7 below says
otherwise. This PRD only adds what the CV needs.

Source tags, as in the brief:
- **Owner:** decided by the owner.
- **Proposal:** Claude's suggestion, not yet agreed.
- **Fact:** checked, with the date.

---

## 0. Decided on 24 Nov 2026

| | Decision | Source |
|---|---|---|
| D1 | **Self-service, on the same platform and account as the card.** One person's card and CV share the profile block (PL-2). | Owner |
| D2 | **Address:** `cv.pulzarstudio.cz/jana-novakova`. | Owner |
| D3 | **Billing.** A one-off price covers 12 months, then a low yearly renewal. Pausing takes the CV offline and keeps the data, at no charge. Students get a discount on Základ. | Owner |
| D4 | **Three tiers: Základ, Profi and Na míru**, mirroring the web packages. | Owner |
| D5 | **It extends LinkedIn rather than replacing it.** A personal link for LinkedIn and job applications. No network, feed or messages. | Owner |
| D6 | **A PDF made from the same content. Fixed sections and templates.** | Owner |
| D7 | **Work starts after the main frame** (Owner), **and after the card's phase 1, because it reuses that platform** (Proposal). | Owner + Proposal |

**Fact (24 Nov 2026):** `ezivotopis.cz` is a working Czech CV builder (*"profesionální životopis na pár
kliknutí"*), and `online-zivotopis.cz` is a how-to blog. Hosting the CV at D2's address avoids any clash with
either name.

---

## 1. Problem

A job seeker keeps the same CV in three places: a PDF made in Word or Canva, LinkedIn, and the job portals. The
three drift apart. The PDF can't show projects properly, and a LinkedIn profile looks like every other profile
row. Graduates have little experience to list, so their projects carry the CV. Today the choice is between a
builder that only makes a PDF and a website builder, which is too much work and has no CV structure.

For the studio, this is a product for individuals, a new audience (Owner). It reuses the card's platform, and job
seasons such as spring fairs and summer graduates bring regular new buyers.

## 2. Goals

**User goals**
- **G1:** the median time from starting (or importing) to a published CV is 20 minutes or less.
- **G2: one source, two outputs.** The web page and the PDF always match. Applicant tracking systems can read the
  PDF, meaning its text extracts in reading order.
- **G3: the holder decides who sees it.** It is link-only by default, and contact details are hidden from bots.

**Business goals** (the targets are a Proposal; the owner sets them, see O6)
- **G4:** 40 paid CVs within 6 months of launch, at least 30 % of them at the student price.
- **G5:** at least half the CVs whose paid year ends are paused or renewed rather than deleted, so their holders
  come back for the next job search.
- **G6:** at least 15 % of CV holders also buy a card within 12 months.

## 3. Non-goals

- **No job board**, no recruiter search, no application tracking and no messages (D5).
- **No network:** no feed, followers or endorsements (D5).
- **No free-form sections, layouts or extra pages.** It's a CV, not a website. Owner: *"much stricter limits"*.
- **No cover letters in v1.** They are P2.
- **No AI writing in v1.** Na míru covers *"help me write it"*, with a real person.
- **No sensitive fields** (CV-6).
- **No printing.**

## 4. Who it's for

| Persona | Who | What they need |
|---|---|---|
| **Student or graduate** | Aged 19–26, looking for a first job or an internship, with little money. Projects and school work matter more than history | The student price, projects, both languages |
| **Experienced professional or career changer** | Aged 30–50, applying through portals and LinkedIn | A sharp page and a PDF in one place, and privacy |
| **Freelancer or creative** | Shows their work | Profi's projects and their own domain |
| **Reader: recruiter or hiring manager** | Opens the link from LinkedIn or an application, on a desktop or a phone. May print or forward the PDF | A page that loads fast and reads at a glance, with the PDF one click away |
| **Studio** | Runs the Na míru sessions | A clean way to fill the CV into the editor |

## 5. Tiers and prices

The shape is the owner's (D3, D4). Contents and numbers are a **Proposal**.

| | **Základ** | **Profi** | **Na míru** |
|---|---|---|---|
| Address | `cv.pulzarstudio.cz/jmeno` | also your own domain or subdomain (CV-10) | as Profi |
| Languages | CS or EN | CS + EN | CS + EN |
| Templates | 3, colour from a list | 3, your own accent colour | as Profi, plus the studio's design touch within the template (cover image, accent, photo crop) |
| Projects | up to 3, text and link | up to 8, with an image | up to 8 |
| PDF | ✓ | ✓ per language | ✓ per language |
| Statistics (P1) | – | ✓ | ✓ |
| Studio help | – | – | A 60-minute session: we write or edit the text with you (CS/EN) and fill it in; you approve it before it goes live |

**Price candidates** in Kč. Each price covers 12 months, and every tier renews at the same price:

| | A | **B: recommended** | C |
|---|---|---|---|
| Základ | 490 | **690** | 990 |
| Základ, student | 290 | **390** | 490 |
| Profi | 990 | **1 490** | 1 990 |
| Na míru | 2 990 | **3 990** | 4 990 |
| Renewal, any tier | 290/rok | **390/rok** | 490/rok |
| Pause | 0 | **0** | 0 |
| Registering your own domain (Profi, Na míru) | od 390/rok | **od 390/rok** | od 390/rok |

Why B:
- A three-month job search on a monthly CV builder costs about as much as a year of Základ. Kickresume Pro is
  reported at around 16 USD a month; verify before quoting it.
- Na míru is Profi plus about 2.5 hours of studio time at 1 000 Kč an hour: the session, the preparation and the
  filling in.
- Renewal is the same for every tier, because the session was a one-off, and a domain is billed as its own add-on.
- Reuse the existing add-on, "další doména od 390 Kč ročně".

---

## 6. User stories

**Holder**
1. As a graduate, I want a CV page with my school projects, so that an employer sees what I can do rather than
   my lack of experience.
2. As a job seeker, I want one link for my LinkedIn profile and my applications, so that I don't send out
   different versions.
3. As a job seeker, I want to download a PDF that matches my page, for portals that only take attachments.
4. As a job seeker, I want to import my LinkedIn data, so that I don't type my history twice (P1).
5. As a holder, I want my phone and e-mail kept away from bots, while a recruiter can still reach me.
6. As someone who still has a job, I want the CV to be link-only, so that it doesn't appear on Google.
7. As someone who has found a job, I want to pause my CV and bring it back next time with the same link.
8. As a Profi holder, I want my CV in Czech and English, so that I can apply abroad.
9. As a Na míru client who struggles to write about myself, I want the studio to write it with me.
10. *Edge case:* when my CV goes over a limit, I want to see what's over and what to cut, not have it truncated
    without a word.

**Reader**
11. As a recruiter, I want to read the CV in 30 seconds on my phone and download the PDF in one tap.
12. As a recruiter, I want to copy the e-mail address after one click.

**Studio**
13. As the studio, I want to fill in a Na míru client's CV from my session notes and send it to them for approval.

---

## 7. Requirements

**Platform.** PL-1 to PL-15 from the card PRD are P0 here as written, with two CV deviations:
- **PL-9:** the CV defaults to *"Jen s odkazem"* (`noindex`). Indexing is opt-in (CV-5).
- **PL-7:** pausing (CV-8) is a second state alongside expiry.

### P0

- **CV-1 Fixed sections and limits.**

  | Section | Limit |
  |---|---|
  | Hlavička | Name; headline of 80 characters; photo (optional); city or region only; links (LinkedIn, GitHub, Behance, Dribbble, website, plus one more) |
  | O mně | 600 characters |
  | Zkušenosti | 8 entries: role, employer, from–to (month and year, or *"dosud"*), and up to 5 bullets of 160 characters |
  | Vzdělání | 5 entries: school, field, from–to, and up to 2 bullets |
  | Projekty | 3 in Základ (text and link), 8 in Profi and Na míru (with an image). Title of 60 characters, text of 300 |
  | Dovednosti | 20 tags, optionally sorted into up to 4 groups |
  | Jazyky | 6 languages, each with a CEFR level (A1–C2) or *"rodilý mluvčí"* |
  | Certifikáty a kurzy | 8 entries: name, issuer, year |
  | Kontakt | E-mail and phone, revealed through CV-4 |
  | Zájmy | Optional, 160 characters |

  Sections can be hidden and reordered within this fixed set. A graduate puts Vzdělání first, for example.
  Nothing can be added.
  *AC:* when the holder goes over a limit, the editor shows what is over and cuts nothing on its own.
- **CV-2 Templates.**
  - Three at launch, each with a web layout and an A4 print layout. Their names are a Proposal.
  - Základ picks from 6 accent colours. Profi and Na míru pick their own accent, contrast-checked.
  - Each template has one pair of fonts.
- **CV-3 PDF.**
  - Generated from the same data at every publish, and stored.
  - A4, with selectable text, embedded fonts with full Czech diacritics, a reading order that follows the visual
    order, and clickable links.
  - The file is 500 kB or less with a photo, and is named `Jana-Novakova-CV.pdf` (with `-EN` for English).
  - *AC:* content at every maximum limit fits 2 pages in Základ and 3 in Profi, in each template. A test fixture
    checks this.
  - *AC, applicant tracking systems:* `pdftotext` output holds every section in order. This check is part of the
    test suite.
- **CV-4 Contact details hidden from bots.**
  - The e-mail and phone are not in the page HTML.
  - The page shows *"Zobrazit kontakt"*. A click fetches the details from the server, behind Turnstile.
  - The PDF contains the contact details, so downloading it goes through the same check.
  - This is the one place where a public page needs JavaScript, 3 kB or less (PL-13). Turnstile loads only on that
    click (PL-14).
  - *AC:* one click is enough to see and copy the e-mail, and the page's HTML source holds neither the e-mail nor
    the phone.
- **CV-5 Visibility.**
  - *"Jen s odkazem"* is the default: `noindex`, and not in the sitemap.
  - *"Veřejný"* means indexed. The holder opts in, with a sentence explaining what that means.
  - Private with a PIN is P1 (CV-14).
- **CV-6 No sensitive fields.**
  - The editor has no field for date of birth, age, marital status, children, nationality, birth number, ID or a
    full street address. Location is the city or region.
  - The photo is optional, with a note that no one needs one.
  - Why: data minimisation under GDPR, and most of this is what employers may not ask about anyway. A CV on the
    open web shouldn't carry what identity thieves look for.
- **CV-7 Links out to LinkedIn, with help.** Profile links show as icons. The editor's help explains how to add the
  CV link to LinkedIn (Contact info → Website, and the Featured section).
  *AC:* the help text is checked against LinkedIn's interface at launch.
- **CV-8 Pause** (brief question 2).
  - *"Pozastavit"* takes the CV offline at once. The page uses PL-7's inactive state, worded
    *"Tento životopis teď není zveřejněný."*
  - The data is kept at no charge, and the URL stays the same.
  - Reactivating within the paid period is free. After it ends, it costs the renewal price.
  - Once a year the holder gets an e-mail asking *"Chcete životopis dál uchovat?"*. With no answer in 30 days, the
    CV is deleted, after a warning.
  - Paid time keeps running during a pause. Not freezing it keeps billing simple (Proposal).
- **CV-9 Two languages (Profi and Na míru).** Every text field has Czech and English versions, the page has a
  language switch, and there is one PDF per language.
- **CV-10 Your own address (Profi and Na míru):** `jmeno.cz` or `cv.jmeno.cz`.
  - In phase 1 the domain's DNS must be on the studio's Cloudflare account. Either the studio registers it (the
    "od 390 Kč/rok" add-on) or the holder moves the DNS.
  - Domains whose DNS stays with the holder wait for P2, as for the card.
- **CV-11 The Na míru flow.**
  - After paying, the holder books the 60-minute session by phone or video. Proposal: by e-mail at first, then
    through Pulz booking once it's live.
  - The studio fills in the CV through the admin, which logs it (PL-11).
  - The holder gets *"Váš životopis je připravený ke schválení"* and publishes it themselves. Nothing goes live
    without their click.
  - *AC:* the studio can't publish a CV it has filled in.
- **CV-12 Student price.**
  - Proof (Proposal; O3): a magic link to a school e-mail address, or an ISIC number checked by the studio.
  - It applies to Základ, for the first year only. Renewal is at the normal price.

### P1

- **CV-13 LinkedIn import.**
  - The holder uploads the ZIP from LinkedIn's *"Get a copy of your data"*.
  - Its Profile, Positions, Education, Skills, Languages and Certifications map onto the sections.
  - The holder reviews everything before it's saved. Entries over a limit are flagged, not dropped.
  - Check LinkedIn's export format at build time (E2).
- **CV-14 Private with a PIN.** A 4–6 digit PIN that the holder gives out with an application. Attempts are rate-limited.
- **CV-15 Statistics** (PL-16): views, PDF downloads and contact reveals.
- **CV-16 Schema.org markup:** `ProfilePage` and `Person` on public CVs only.
- **CV-17 One click to the other product.** A card filled in from the CV, or a CV started from the card. PL-2
  already shares the profile block; this adds the one-click *"create the other one"*.

### P2

- **Per-application links:** one link per employer, to see who opened it. This needs a privacy review first.
- **A cover letter** on the same template.
- **More templates.**

---

## 8. Success metrics

Measured as for the card (no cookies, the platform's own database). Review at 1, 3, 6 and 12 months.

**Leading indicators**

| Metric | Success / stretch |
|---|---|
| CVs started and published within 7 days | 35 % / 50 % |
| Median time to publish | ≤ 20 min / ≤ 12 min |
| Published CVs read by someone other than the holder within 30 days (it's actually being sent) | 70 % / 85 % |
| E-mail addresses found in public HTML (an automated test across all CVs) | 0, always |

**Lagging indicators**

| Metric | Success / stretch |
|---|---|
| Paid CVs after 6 months | 40 / 80 |
| Share at the student price | at least 30 % |
| CVs paused or renewed when their year ends | 50 % / 65 % |
| CV holders who also buy a card within 12 months | 15 % / 25 % |
| Na míru sales in 6 months | 5 / 10 |

---

## 9. Open questions

The last column names what can't start until the question is answered.

| # | Question | Who | Blocks |
|---|---|---|---|
| O1 | Prices: A, B or C (§5)? | Owner | sales page |
| O2 | Name: "Pulzar CV" or "Pulzar Životopis"? Sales page address: `/zivotopis/`, `/online-zivotopis/` (what people search for) or `/cv/`? An EN twin? | Owner | sales page |
| O3 | Student proof: a school e-mail, an ISIC number, or trust? | Owner | CV phase |
| O4 | Na míru: by phone or video only, or in person too? Who runs the sessions, Alex or Samuel, and how many a week fit? | Owner | phase CV-b |
| O5 | Launch season: should we aim for the spring job fairs and the summer graduates? Check this season's fair dates. | Owner | plan |
| O6 | Keep the targets in §2 and §8, or change them? | Owner | – |
| O7 | Where to find the audience (brief Q5): which channel in §11 comes first, and is a discount code per school worth setting up? | Owner | marketing |
| L1 | A /gdpr/ section for the CV: more personal data than a card, contact details behind a click, and how long data is kept during a pause. | Lawyer | CV phase |
| L2 | Terms: the holder confirms the content is true and theirs, and is responsible for photos of other people. | Lawyer | CV phase |
| E1 | **PDF engine on Workers.** Rendering at publish with a JavaScript PDF library inside the Worker, Cloudflare Browser Rendering (headless Chrome, paid by use), or a small renderer next to Pulz. Decide after a spike; it must pass CV-3. | Engineering | CV phase |
| E2 | LinkedIn export: the current file names and fields. | Engineering | P1 |
| E3 | Turnstile for the contact reveal: reuse the site's widget or create a new one for the `cv.` host. | Engineering | CV phase |

---

## 10. Timeline and phases

Proposal: this is phase 3 of the platform plan in the card PRD, starting once the card's phase 1 is stable. The
CV reuses PL-1 to PL-15 and adds the PDF engine, the CV sections, pausing and the Na míru flow.

Job fairs cluster in spring and graduates look for work over the summer, so it's worth launching publicly before
the spring fairs (O5).

| Phase | Ships |
|---|---|
| CV-a | Základ and Profi (without own domains), the PDF, pausing and the student price; the sales page; the /prace/ tile at "Beta" |
| CV-b | The Na míru flow (needs O4), own domains, statistics, the LinkedIn import |

## 11. Reaching the new audience (brief Q5)

Job seekers aren't the studio's firms. Channels, cheapest first (Proposal):
1. **Social clips from `../pulzar-social`.** A before-and-after of "your CV as a link". The studio already renders
   clips like these.
2. **University career centres and student unions,** with a discount code per school, which also shows which
   school works.
3. **The studio's own LinkedIn.** The CV is a LinkedIn add-on, so post examples there.
4. **Spring job fairs,** with a QR code leading to a sample CV.

Each channel gets its own `?src=`, so §8 can show which one works.

## 12. Work on the studio site

- **Sales page** at the address O2 settles, built like /poukazy/:
  - a real CV on a laptop, with its PDF beside it, and a section on "LinkedIn + this link";
  - the tiers and prices with the student price, in `tabular-nums`;
  - an FAQ that starts with privacy, and a button that leads to sign-up;
  - an entry in `ROUTES`.
- **The /prace/ tile:** Ve vývoji, then Beta (card PRD §11).
- **/gdpr/:** the CV section (L1).
- **Ceník:** one row linking to the sales page.

---

## Appendix: sources

- eŽIVOTOPIS.cz (title checked 24 Nov 2026): https://ezivotopis.cz/
- Kickresume's personal website product: https://www.kickresume.com/sk/osobny-web/ (the Pro price reported in a
  Slovak review; verify)
- Jobs.cz on online CVs: https://www.jobs.cz/poradna/jak-vypada-online-cv-kteremu-nehrozi-delete/
