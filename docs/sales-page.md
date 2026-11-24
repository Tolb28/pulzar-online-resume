# Sales page draft (PRD §12)

Content for the studio site's sales page, to port into the studio repository (built like /poukazy/). The address
and name wait for O2; prices are option B from `src/config/tiers.ts` and wait for O1. Czech copy, Proposal.

---

## Hero

**Životopis jako odkaz. A PDF ze stejného obsahu.**

Jeden odkaz pro LinkedIn a přihlášky. Stránka, která se čte za 30 vteřin i na mobilu, a PDF, které přečtou i
náborové systémy.

[Vytvořit životopis] → `https://cv.pulzarstudio.cz/prihlaseni?src=web`

*Visual:* a real published CV on a laptop, its PDF beside it (use a consenting real CV or the studio's own).

## LinkedIn + tento odkaz

LinkedIn nenahrazujeme, doplňujeme ho. Odkaz si dáte do kontaktních údajů a do sekce Doporučené. Kdo klikne, uvidí
přehledný životopis s projekty a PDF na jedno kliknutí.

## Co dostanete

- Hotový životopis za 20 minut: pevné sekce a limity, které vás udrží stručné.
- Tři šablony, barva podle vás, fotka jen pokud chcete.
- PDF ze stejného obsahu: A4, s českou diakritikou, čitelné pro náborové systémy.
- Pozastavení zdarma: našli jste práci? Životopis schováte a příště ho vrátíte na stejném odkazu.

## Ceny (tabular-nums)

| | Základ | Profi | Na míru |
|---|---|---|---|
| Na 12 měsíců | 690 Kč | 1 490 Kč | 3 990 Kč |
| Studenti (první rok) | 390 Kč | – | – |
| Další rok | 390 Kč | 390 Kč | 390 Kč |
| Pozastavení | zdarma | zdarma | zdarma |
| Jazyky | CS nebo EN | CS + EN | CS + EN |
| Projekty | 3 | 8, s obrázky | 8, s obrázky |
| Barva | 6 na výběr | vlastní | vlastní |
| Statistiky | – | ✓ | ✓ |
| Vlastní doména | – | ✓ (od 390 Kč/rok) | ✓ (od 390 Kč/rok) |
| Se studiem | – | – | 60 minut: text napíšeme s vámi a vyplníme ho |

## Časté otázky (privacy first)

**Uvidí můj životopis každý?**
Ne. Výchozí je „jen s odkazem“: uvidí ho ten, komu odkaz pošlete, a vyhledávače ho nenajdou. Zveřejnit ho pro
vyhledávače můžete, když budete chtít. A můžete ho zamknout PINem.

**Najdou roboti můj e-mail a telefon?**
Ne. Kontakt není ve zdrojovém kódu stránky. Návštěvník klikne na „Zobrazit kontakt“ a projde krátkým ověřením;
každý den kontrolujeme, že se kontakt na žádnou stránku nedostal.

**Proč tam nejde datum narození nebo adresa?**
Do životopisu na webu nepatří a zaměstnavatel se na ně ptát nesmí. Stačí město. Fotka je dobrovolná.

**Co když zrovna práci nehledám?**
Životopis pozastavíte zdarma. Data i odkaz zůstanou. Jednou ročně se zeptáme, jestli ho chcete uchovat dál.

**Funguje to s LinkedInem?**
Ano. Data z LinkedInu načtete z exportu „Získat kopii vašich dat“ a odkaz na životopis přidáte do profilu.

**Jak funguje Na míru?**
Po zaplacení se ozveme a domluvíme hodinu po telefonu nebo videu. Text napíšeme nebo upravíme s vámi, česky i
anglicky, a vyplníme ho. Zveřejníte ho vy – bez vašeho kliknutí se nic nezveřejní.

**Jak dokážu, že jsem student?**
Školním e-mailem, nebo číslem ISIC, které ověříme do jednoho pracovního dne.

## Elsewhere on the studio site

- `ROUTES`: add the page.
- `/prace/`: the tile goes from "Ve vývoji" to "Beta" with phase CV-a.
- Ceník: one row linking here.
- `/gdpr/`: the CV section (L1); [plan.md](plan.md) §12 lists the facts.
- Channels (§11): give each its own `?src=` on the sign-up link. The CV records it on the account as
  `signup_src`, and every CV's footer links back here with `?src=cv-footer`.
