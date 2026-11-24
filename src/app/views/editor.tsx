import type { Child } from 'hono/jsx';
import { LIMITS } from '../../config/limits';
import { ACCENT_PALETTE, MIN_ACCENT_CONTRAST, TEMPLATES, TEMPLATE_IDS } from '../../config/templates';
import { TIERS } from '../../config/tiers';
import { contrastRatio } from '../../cv/color';
import { LANGUAGE_NAMES, LEVEL_LABELS, SECTION_LABELS } from '../../cv/i18n';
import { CEFR_LEVELS, type BodySectionKey, type CvDoc, type HideableSectionKey, type L10n, type LinkKind } from '../../cv/types';
import type { Issue, IssueSection } from '../../cv/validate';
import { Checkbox, IssueList, L10nField, OpButton, Select, TextField, type FieldCtx } from './fields';

export const EDITOR_SECTIONS: ReadonlyArray<{ key: string; label: string; section: IssueSection }> = [
  { key: 'hlavicka', label: 'Hlavička', section: 'header' },
  { key: 'kontakt', label: 'Kontakt', section: 'contact' },
  { key: 'o-mne', label: 'O mně', section: 'about' },
  { key: 'zkusenosti', label: 'Zkušenosti', section: 'experience' },
  { key: 'vzdelani', label: 'Vzdělání', section: 'education' },
  { key: 'projekty', label: 'Projekty', section: 'projects' },
  { key: 'dovednosti', label: 'Dovednosti', section: 'skills' },
  { key: 'jazyky', label: 'Jazyky', section: 'languages' },
  { key: 'certifikaty', label: 'Certifikáty a kurzy', section: 'certifications' },
  { key: 'zajmy', label: 'Zájmy', section: 'interests' },
  { key: 'poradi', label: 'Pořadí a skrytí', section: 'settings' },
  { key: 'vzhled', label: 'Vzhled', section: 'design' },
];

export const sectionByKey = (key: string) => EDITOR_SECTIONS.find((s) => s.key === key);

export interface EditorProps {
  doc: CvDoc;
  issues: Issue[];
  sectionKey: string;
  /** "/ucet/upravit" or "/admin/cv/<id>/upravit" */
  base: string;
  /** Where image uploads go. */
  mediaAction: string;
  mode: 'holder' | 'admin';
  previewHref: string;
  saveProblem?: string | null;
}

const LINK_ROWS: Array<[LinkKind, string, string]> = [
  ['linkedin', 'LinkedIn', 'linkedin.com/in/jana-novakova'],
  ['github', 'GitHub', 'github.com/jana'],
  ['behance', 'Behance', 'behance.net/jana'],
  ['dribbble', 'Dribbble', 'dribbble.com/jana'],
  ['website', 'Web', 'jananovakova.cz'],
  ['other', 'Další odkaz', 'odkaz na portfolio, blog…'],
];

function Fieldset(props: { legend: string; children: Child; actions?: Child; issues?: Issue[] }) {
  return (
    <fieldset class="entry">
      <legend>{props.legend}</legend>
      {props.actions && <div class="entry-actions">{props.actions}</div>}
      {props.issues && <IssueList issues={props.issues} />}
      {props.children}
    </fieldset>
  );
}

function MoveButtons({ i, n, what }: { i: number; n: number; what: string }) {
  return (
    <>
      {i > 0 && <OpButton op={`up:${i}`} label="↑" title="Posunout výš" />}
      {i < n - 1 && <OpButton op={`down:${i}`} label="↓" title="Posunout níž" />}
      <OpButton op={`del:${i}`} label={`Smazat ${what}`} kind="danger" />
    </>
  );
}

function Dates({ name, path, from, to, ctx }: { name: string; path: string; from: string; to: string | null; ctx: FieldCtx }) {
  return (
    <div class="row">
      <TextField ctx={ctx} name={`${name}.from`} path={`${path}.from`} label="Od (měsíc a rok)" value={from} type="month" placeholder="2021-03" />
      <TextField ctx={ctx} name={`${name}.to`} path={`${path}.to`} label="Do" value={to ?? ''} type="month" placeholder="2023-06" />
      <Checkbox name={`${name}.present`} label="dosud" checked={to === null && !!from} />
    </div>
  );
}

function Bullets(props: { ctx: FieldCtx; name: string; path: string; bullets: L10n[]; max: number; length: number; label: string }) {
  const slots = props.bullets.length < props.max ? [...props.bullets, { cs: '', en: '' }] : props.bullets;
  return (
    <div class="bullets">
      <p class="sub">
        {props.label} (nejvýš {props.max}, každá do {props.length} znaků; prázdnou smažete vymazáním textu)
      </p>
      <IssueList issues={props.ctx.issues.filter((i) => i.path === props.path)} />
      {slots.map((b, j) => (
        <L10nField ctx={props.ctx} name={`${props.name}.${j}`} path={`${props.path}.${j}`} label={j < props.bullets.length ? `Odrážka ${j + 1}` : 'Nová odrážka'} value={b} max={props.length} />
      ))}
    </div>
  );
}

function ListHeader({ ctx, path, count, max, unit }: { ctx: FieldCtx; path: string; count: number; max: number; unit: string }) {
  return (
    <>
      <p class={count > max ? 'sub over' : 'sub'}>
        {count} / {max} {unit}
      </p>
      <IssueList issues={ctx.issues.filter((i) => i.path === path)} />
    </>
  );
}

function AddButton({ count, max, label }: { count: number; max: number; label: string }) {
  return count < max ? <OpButton op="add" label={`+ ${label}`} kind="quiet" /> : <p class="sub">Máte všech {max}. Pro další položku nejdřív některou smažte.</p>;
}

function UploadForms({ forms, action }: { forms: Array<{ id: string; kind: string; target?: string }>; action: string }) {
  return (
    <>
      {forms.map((f) => (
        <form id={f.id} method="post" action={action} enctype="multipart/form-data" class="hidden-form" data-upload={f.kind}>
          <input type="hidden" name="kind" value={f.kind} />
          {f.target && <input type="hidden" name="target" value={f.target} />}
        </form>
      ))}
    </>
  );
}

function ImagePicker(props: { formId: string; label: string; current: string | null; removeOp?: string; accept: string; help?: Child }) {
  return (
    <div class="field image-field">
      <span class="label">{props.label}</span>
      {props.current && <img src={props.current} alt="" class="thumb" width={96} height={96} />}
      <input type="file" name="file" form={props.formId} accept={props.accept} aria-label={props.label} />
      <button type="submit" form={props.formId} class="btn small quiet">
        Nahrát
      </button>
      {props.current && props.removeOp && <OpButton op={props.removeOp} label="Odebrat" kind="danger" />}
      {props.help && <p class="help">{props.help}</p>}
    </div>
  );
}

/** The separate upload forms a section needs (file inputs point at them with form="…"). */
export function uploadFormsFor(p: Pick<EditorProps, 'doc' | 'sectionKey' | 'mode'>): Array<{ id: string; kind: string; target?: string }> {
  const tier = TIERS[p.doc.tier];
  if (p.sectionKey === 'hlavicka') return [{ id: 'up-photo', kind: 'photo' }];
  if (p.sectionKey === 'projekty' && tier.projectImages) return p.doc.body.projects.map((pr) => ({ id: `up-project-${pr.id}`, kind: 'project', target: pr.id }));
  if (p.sectionKey === 'vzhled' && p.mode === 'admin' && tier.studioDesign) return [{ id: 'up-cover', kind: 'cover' }];
  return [];
}

const media = (k: string) => `/media/${k}`;

function SectionForm(p: EditorProps & { ctx: FieldCtx }) {
  const { doc, ctx } = p;
  const b = doc.body;
  const L = LIMITS;
  const tier = TIERS[doc.tier];
  switch (p.sectionKey) {
    case 'hlavicka': {
      const pr = doc.profile;
      return (
        <>
          <TextField ctx={ctx} name="name" path="profile.name" label="Jméno a příjmení" value={pr.name} max={L.profile.name} autocomplete="name" />
          <L10nField ctx={ctx} name="headline" path="profile.headline" label="Titulek" value={pr.headline} max={L.profile.headline} placeholder={{ cs: 'Produktová designérka, e-commerce', en: 'Product designer, e-commerce' }} help="Kdo jste a co hledáte, jednou větou." />
          <L10nField ctx={ctx} name="location" path="profile.location" label="Město nebo kraj" value={pr.location} max={L.profile.location} help="Jen město nebo kraj. Ulici, číslo domu ani PSČ na web nedávejte." />
          <ImagePicker
            formId="up-photo"
            label="Fotka (nepovinná)"
            current={pr.photo ? media(pr.photo.key) : null}
            removeOp="photo:remove"
            accept="image/*"
            help="Fotku nikdo nevyžaduje a životopis bez ní je úplně v pořádku. Editor ji zmenší a odstraní z ní údaje o místě a fotoaparátu."
          />
          <h2 class="h3">Odkazy</h2>
          <p class="help">
            Zobrazí se jako ikony. <a href="/ucet/napoveda/linkedin">Jak přidat odkaz na životopis do LinkedInu</a>
          </p>
          <IssueList issues={ctx.issues.filter((i) => i.path === 'profile.links')} />
          {LINK_ROWS.map(([kind, label, placeholder]) => {
            const idx = pr.links.findIndex((l) => l.kind === kind);
            const link = pr.links[idx];
            return (
              <div class="row">
                {kind === 'other' && <TextField ctx={ctx} name="links.other.label" path={`profile.links.${idx}.label`} label="Název odkazu" value={link?.label ?? ''} max={L.profile.linkLabel} />}
                <TextField ctx={ctx} name={`links.${kind}.url`} path={`profile.links.${idx}.url`} label={label} value={link?.url ?? ''} placeholder={placeholder} type="url" />
              </div>
            );
          })}
        </>
      );
    }
    case 'kontakt':
      return (
        <>
          <p class="note">
            E-mail ani telefon nejsou ve zdrojovém kódu stránky, takže je roboti nenajdou. Návštěvník klikne na „Zobrazit kontakt“ a projde krátkým ověřením. V PDF kontakt je, proto se ke stažení PDF jde přes stejné ověření.
          </p>
          <TextField ctx={ctx} name="email" path="profile.email" label="E-mail" value={doc.profile.email} type="email" autocomplete="email" />
          <TextField ctx={ctx} name="phone" path="profile.phone" label="Telefon" value={doc.profile.phone} type="tel" autocomplete="tel" placeholder="+420 777 123 456" />
          <Checkbox name="hideContact" label="Kontakt na stránce ani v PDF nezobrazovat" checked={b.layout.hidden.includes('contact')} />
        </>
      );
    case 'o-mne':
      return <L10nField ctx={ctx} name="about" path="body.about" label="O mně" value={b.about} max={L.about} multiline rows={8} help="Pár vět o tom, co umíte, co vás baví a co hledáte." />;
    case 'zajmy':
      return <L10nField ctx={ctx} name="interests" path="body.interests" label="Zájmy (nepovinné)" value={b.interests} max={L.interests} multiline rows={3} />;
    case 'zkusenosti':
      return (
        <>
          <ListHeader ctx={ctx} path="body.experience" count={b.experience.length} max={L.experience.items} unit="pozic" />
          {b.experience.map((e, i) => (
            <Fieldset legend={`Zkušenost ${i + 1}`} actions={<MoveButtons i={i} n={b.experience.length} what="zkušenost" />}>
              <input type="hidden" name={`experience.${i}.id`} value={e.id} />
              <L10nField ctx={ctx} name={`experience.${i}.role`} path={`body.experience.${i}.role`} label="Pozice" value={e.role} max={L.experience.role} />
              <TextField ctx={ctx} name={`experience.${i}.employer`} path={`body.experience.${i}.employer`} label="Zaměstnavatel" value={e.employer} max={L.experience.employer} />
              <Dates ctx={ctx} name={`experience.${i}`} path={`body.experience.${i}`} from={e.from} to={e.to} />
              <Bullets ctx={ctx} name={`experience.${i}.bullets`} path={`body.experience.${i}.bullets`} bullets={e.bullets} max={L.experience.bullets} length={L.experience.bullet} label="Co jste dělali a čeho jste dosáhli" />
            </Fieldset>
          ))}
          <AddButton count={b.experience.length} max={L.experience.items} label="Přidat zkušenost" />
        </>
      );
    case 'vzdelani':
      return (
        <>
          <ListHeader ctx={ctx} path="body.education" count={b.education.length} max={L.education.items} unit="škol" />
          {b.education.map((e, i) => (
            <Fieldset legend={`Vzdělání ${i + 1}`} actions={<MoveButtons i={i} n={b.education.length} what="školu" />}>
              <input type="hidden" name={`education.${i}.id`} value={e.id} />
              <L10nField ctx={ctx} name={`education.${i}.school`} path={`body.education.${i}.school`} label="Škola" value={e.school} max={L.education.school} />
              <L10nField ctx={ctx} name={`education.${i}.field`} path={`body.education.${i}.field`} label="Obor" value={e.field} max={L.education.field} />
              <Dates ctx={ctx} name={`education.${i}`} path={`body.education.${i}`} from={e.from} to={e.to} />
              <Bullets ctx={ctx} name={`education.${i}.bullets`} path={`body.education.${i}.bullets`} bullets={e.bullets} max={L.education.bullets} length={L.education.bullet} label="Diplomová práce, ocenění, výměnný pobyt…" />
            </Fieldset>
          ))}
          <AddButton count={b.education.length} max={L.education.items} label="Přidat školu" />
        </>
      );
    case 'projekty':
      return (
        <>
          <ListHeader ctx={ctx} path="body.projects" count={b.projects.length} max={tier.projects} unit={`projektů (${tier.name})`} />
          {b.projects.map((pr, i) => {
            const formId = `up-project-${pr.id}`;
            return (
              <Fieldset legend={`Projekt ${i + 1}`} actions={<MoveButtons i={i} n={b.projects.length} what="projekt" />}>
                <input type="hidden" name={`projects.${i}.id`} value={pr.id} />
                <L10nField ctx={ctx} name={`projects.${i}.title`} path={`body.projects.${i}.title`} label="Název" value={pr.title} max={L.projects.title} />
                <L10nField ctx={ctx} name={`projects.${i}.text`} path={`body.projects.${i}.text`} label="Popis" value={pr.text} max={L.projects.text} multiline rows={4} />
                <TextField ctx={ctx} name={`projects.${i}.url`} path={`body.projects.${i}.url`} label="Odkaz (nepovinný)" value={pr.url} type="url" />
                {tier.projectImages ? (
                  <ImagePicker formId={formId} label="Obrázek (jen na webu)" current={pr.image ? media(pr.image.key) : null} removeOp={`image:remove:${i}`} accept="image/*" />
                ) : (
                  pr.image && <p class="sub">Obrázek je uložený, ale v Základu se nezobrazí.</p>
                )}
              </Fieldset>
            );
          })}
          <AddButton count={b.projects.length} max={tier.projects} label="Přidat projekt" />
          {!tier.projectImages && <p class="help">Profi a Na míru mají až 8 projektů a s obrázkem.</p>}
        </>
      );
    case 'dovednosti': {
      const groups = b.skills.groups.length ? b.skills.groups : [{ id: 'g0', name: { cs: '', en: '' }, tags: [] }];
      const shown = b.skills.grouped ? groups : [{ ...groups[0]!, tags: groups.flatMap((g) => g.tags) }];
      const tagCount = b.skills.groups.reduce((n, g) => n + g.tags.length, 0);
      return (
        <>
          <ListHeader ctx={ctx} path="body.skills" count={tagCount} max={L.skills.tags} unit="dovedností" />
          <Checkbox name="skills.grouped" label={`Seskupit do skupin (nejvýš ${L.skills.groups})`} checked={b.skills.grouped} />
          <IssueList issues={ctx.issues.filter((i) => i.path === 'body.skills.groups')} />
          {shown.map((g, i) => (
            <Fieldset legend={b.skills.grouped ? `Skupina ${i + 1}` : 'Dovednosti'} actions={b.skills.grouped && shown.length > 1 ? <MoveButtons i={i} n={shown.length} what="skupinu" /> : undefined}>
              <input type="hidden" name={`skills.groups.${i}.id`} value={g.id} />
              {b.skills.grouped && <L10nField ctx={ctx} name={`skills.groups.${i}.name`} path={`body.skills.groups.${i}.name`} label="Název skupiny" value={g.name} max={L.skills.groupName} />}
              <div class={ctx.langs.length > 1 ? 'l10n two' : 'l10n'}>
                {ctx.langs.map((lang) => (
                  <div class="field">
                    <label for={`tags-${i}-${lang}`}>
                      Dovednosti{ctx.langs.length > 1 ? ` – ${lang === 'cs' ? 'Česky' : 'English'}` : ''} (jedna na řádek, každá do {L.skills.tag} znaků)
                    </label>
                    <textarea id={`tags-${i}-${lang}`} name={`skills.groups.${i}.tags.${lang}`} rows={6} lang={lang}>
                      {g.tags.map((t) => t[lang]).join('\n')}
                    </textarea>
                  </div>
                ))}
              </div>
              <IssueList issues={ctx.issues.filter((x) => x.path.startsWith(`body.skills.groups.${i}.tags.`))} />
            </Fieldset>
          ))}
          {b.skills.grouped && <AddButton count={shown.length} max={L.skills.groups} label="Přidat skupinu" />}
          {ctx.langs.length > 1 && <p class="help">Dovednosti se párují po řádcích: první řádek česky patří k prvnímu řádku anglicky.</p>}
        </>
      );
    }
    case 'jazyky': {
      const options: Array<[string, string]> = [...Object.entries(LANGUAGE_NAMES).map(([code, n]): [string, string] => [code, n.cs]), ['', 'Jiný jazyk (vypíšu)']];
      return (
        <>
          <ListHeader ctx={ctx} path="body.languages" count={b.languages.length} max={L.languages.items} unit="jazyků" />
          {b.languages.map((l, i) => (
            <Fieldset legend={`Jazyk ${i + 1}`} actions={<MoveButtons i={i} n={b.languages.length} what="jazyk" />} issues={ctx.issues.filter((x) => x.path.startsWith(`body.languages.${i}.`) && !x.path.includes('.name.'))}>
              <input type="hidden" name={`languages.${i}.id`} value={l.id} />
              <div class="row">
                <Select name={`languages.${i}.code`} label="Jazyk" value={l.code} options={options} />
                <Select name={`languages.${i}.level`} label="Úroveň" value={l.level} options={CEFR_LEVELS.map((c): [string, string] => [c, LEVEL_LABELS[c].cs])} help="Podle evropského rámce (A1–C2)." />
              </div>
              {!l.code && <L10nField ctx={ctx} name={`languages.${i}.name`} path={`body.languages.${i}.name`} label="Název jazyka" value={l.name} max={L.languages.name} />}
            </Fieldset>
          ))}
          <AddButton count={b.languages.length} max={L.languages.items} label="Přidat jazyk" />
        </>
      );
    }
    case 'certifikaty':
      return (
        <>
          <ListHeader ctx={ctx} path="body.certifications" count={b.certifications.length} max={L.certifications.items} unit="položek" />
          {b.certifications.map((c, i) => (
            <Fieldset legend={`Certifikát ${i + 1}`} actions={<MoveButtons i={i} n={b.certifications.length} what="položku" />}>
              <input type="hidden" name={`certifications.${i}.id`} value={c.id} />
              <L10nField ctx={ctx} name={`certifications.${i}.name`} path={`body.certifications.${i}.name`} label="Název" value={c.name} max={L.certifications.name} />
              <div class="row">
                <TextField ctx={ctx} name={`certifications.${i}.issuer`} path={`body.certifications.${i}.issuer`} label="Vydal" value={c.issuer} max={L.certifications.issuer} />
                <TextField ctx={ctx} name={`certifications.${i}.year`} path={`body.certifications.${i}.year`} label="Rok" value={c.year ? String(c.year) : ''} type="number" />
              </div>
            </Fieldset>
          ))}
          <AddButton count={b.certifications.length} max={L.certifications.items} label="Přidat certifikát nebo kurz" />
        </>
      );
    case 'poradi': {
      const order = b.layout.order;
      return (
        <>
          <p class="help">Sekce můžete přesouvat a skrývat. Hlavička je vždy nahoře; kontakt je v hlavičce.</p>
          <ol class="order">
            {order.map((key: BodySectionKey, i) => (
              <li>
                <input type="hidden" name={`order.${i}`} value={key} />
                <span>{SECTION_LABELS[key].cs}</span>
                <Checkbox name="hidden" value={key} label="skrýt" checked={b.layout.hidden.includes(key)} />
                {i > 0 && <OpButton op={`up:${i}`} label="↑" title="Výš" />}
                {i < order.length - 1 && <OpButton op={`down:${i}`} label="↓" title="Níž" />}
              </li>
            ))}
          </ol>
          {b.layout.hidden.includes('contact' as HideableSectionKey) && <input type="hidden" name="hidden" value="contact" />}
          <p>
            <OpButton op="preset:graduate" label="Pořadí pro absolventy (vzdělání a projekty napřed)" />
            <OpButton op="preset:default" label="Výchozí pořadí" />
          </p>
        </>
      );
    }
    case 'vzhled': {
      const d = doc.design;
      const ratio = contrastRatio(d.accent, '#ffffff');
      return (
        <>
          <fieldset class="choices">
            <legend>Šablona</legend>
            {TEMPLATE_IDS.map((t) => (
              <label class="choice">
                <input type="radio" name="template" value={t} checked={d.template === t} />
                <strong>{TEMPLATES[t].name}</strong>
                <span>{TEMPLATES[t].description}</span>
              </label>
            ))}
          </fieldset>
          <fieldset class="choices">
            <legend>Barva</legend>
            {tier.ownAccent ? (
              <>
                <div class="row">
                  <div class="field">
                    <label for="accent">Vlastní barva</label>
                    <input type="color" id="accent" name="accent" value={d.accent} data-contrast={MIN_ACCENT_CONTRAST} />
                  </div>
                  <p class={ratio < MIN_ACCENT_CONTRAST ? 'sub over' : 'sub'} data-contrast-out>
                    Kontrast na bílém: {ratio.toFixed(1)} : 1 (potřeba aspoň {MIN_ACCENT_CONTRAST} : 1)
                  </p>
                </div>
                <p class="swatches">
                  {ACCENT_PALETTE.map((a) => (
                    <button type="button" class="swatch" data-color={a.hex} title={a.name} aria-label={a.name}>
                      <span class={`sw sw-${a.id}`}></span>
                    </button>
                  ))}
                </p>
              </>
            ) : (
              <p class="swatches">
                {ACCENT_PALETTE.map((a) => (
                  <label class="swatch">
                    <input type="radio" name="accent" value={a.hex} checked={d.accent === a.hex} />
                    <span class={`sw sw-${a.id}`}></span>
                    {a.name}
                  </label>
                ))}
              </p>
            )}
            <IssueList issues={ctx.issues.filter((i) => i.path === 'design.accent')} />
          </fieldset>
          {p.mode === 'admin' && tier.studioDesign && (
            <ImagePicker formId="up-cover" label="Úvodní obrázek (Na míru)" current={d.cover ? media(d.cover.key) : null} removeOp="cover:remove" accept="image/jpeg,image/png" />
          )}
        </>
      );
    }
  }
  return <p>Neznámá sekce.</p>;
}

export function EditorView(p: EditorProps) {
  const ctx: FieldCtx = { issues: p.issues, langs: p.doc.langs };
  const current = sectionByKey(p.sectionKey);
  const uploads = uploadFormsFor(p);
  const errorsBy = new Map<IssueSection, number>();
  for (const i of p.issues) if (i.severity === 'error') errorsBy.set(i.section, (errorsBy.get(i.section) ?? 0) + 1);
  const sectionIssues = p.issues.filter((i) => i.section === current?.section && !/\.\d+\.|\.(cs|en)$|^profile\.(email|phone)$/.test(i.path));
  return (
    <div class="editor">
      <nav class="tabs" aria-label="Sekce životopisu">
        {EDITOR_SECTIONS.map((s) => (
          <a href={`${p.base}/${s.key}`} aria-current={s.key === p.sectionKey ? 'page' : undefined}>
            {s.label}
            {errorsBy.get(s.section) ? <span class="badge">{errorsBy.get(s.section)}</span> : null}
          </a>
        ))}
      </nav>
      <section class="panel">
        <div class="panel-head">
          <h1>{current?.label}</h1>
          <a class="btn quiet small" href={p.previewHref} target="_blank" rel="noopener">
            Náhled
          </a>
        </div>
        {p.saveProblem && (
          <p class="flash error" role="alert">
            {p.saveProblem}
          </p>
        )}
        <IssueList issues={sectionIssues} />
        <form method="post" action={`${p.base}/${p.sectionKey}`} class="section-form" novalidate>
          <SectionForm {...p} ctx={ctx} />
          <div class="save-bar">
            <button type="submit" class="btn">
              Uložit
            </button>
            <span class="sub">Koncept se ukládá i přes limity – nic neořezáváme. Zveřejnit jde, až bude vše v limitu.</span>
          </div>
        </form>
        <UploadForms forms={uploads} action={p.mediaAction} />
      </section>
    </div>
  );
}
