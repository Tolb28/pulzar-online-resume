import type { Child } from 'hono/jsx';
import { charCount } from '../../cv/text';
import type { L10n, Lang } from '../../cv/types';
import type { Issue } from '../../cv/validate';

// Form fields for the editor. Every field shows its count against the limit and the issues
// for its path, so the holder sees what is over and by how much (CV-1 AC).

export interface FieldCtx {
  issues: Issue[];
  langs: Lang[];
}

const LANG_LABEL: Record<Lang, string> = { cs: 'Česky', en: 'English' };

function issuesAt(ctx: FieldCtx, path: string): Issue[] {
  return ctx.issues.filter((i) => i.path === path);
}

export function IssueList({ issues }: { issues: Issue[] }) {
  if (!issues.length) return null;
  return (
    <ul class="issues">
      {issues.map((i) => (
        <li class={i.severity}>{i.message}</li>
      ))}
    </ul>
  );
}

function Counter({ value, max }: { value: string; max: number }) {
  const n = charCount(value);
  return (
    <span class={n > max ? 'count over' : 'count'} data-count>
      {n} / {max}
    </span>
  );
}

export function TextField(props: {
  ctx: FieldCtx;
  name: string;
  path: string;
  label: string;
  value: string;
  max?: number;
  multiline?: boolean;
  rows?: number;
  type?: string;
  help?: Child;
  placeholder?: string;
  required?: boolean;
  autocomplete?: string;
  lang?: Lang;
}) {
  const own = issuesAt(props.ctx, props.path);
  const id = props.name.replace(/[^a-zA-Z0-9]/g, '_');
  const attrs = {
    id,
    name: props.name,
    placeholder: props.placeholder,
    required: props.required,
    autocomplete: props.autocomplete ?? 'off',
    lang: props.lang,
    'data-max': props.max,
    'aria-invalid': own.some((i) => i.severity === 'error') ? 'true' : undefined,
    'aria-describedby': own.length ? `${id}-issues` : undefined,
  };
  return (
    <div class={own.some((i) => i.severity === 'error') ? 'field has-error' : 'field'}>
      <label for={id}>
        {props.label}
        {props.max ? <Counter value={props.value} max={props.max} /> : null}
      </label>
      {props.multiline ? (
        <textarea rows={props.rows ?? 4} {...attrs}>
          {props.value}
        </textarea>
      ) : (
        <input type={props.type ?? 'text'} value={props.value} {...attrs} />
      )}
      {props.help && <p class="help">{props.help}</p>}
      <div id={`${id}-issues`}>
        <IssueList issues={own} />
      </div>
    </div>
  );
}

/** One input per enabled CV language (CV-9). Text in a language the CV does not use is kept. */
export function L10nField(props: {
  ctx: FieldCtx;
  name: string;
  path: string;
  label: string;
  value: L10n;
  max: number;
  multiline?: boolean;
  rows?: number;
  help?: Child;
  placeholder?: Partial<L10n>;
  required?: boolean;
}) {
  const two = props.ctx.langs.length > 1;
  return (
    <div class={two ? 'l10n two' : 'l10n'}>
      {props.ctx.langs.map((lang) => (
        <TextField
          ctx={props.ctx}
          name={`${props.name}.${lang}`}
          path={`${props.path}.${lang}`}
          label={two ? `${props.label} – ${LANG_LABEL[lang]}` : props.label}
          value={props.value[lang] ?? ''}
          max={props.max}
          multiline={props.multiline}
          rows={props.rows}
          help={lang === props.ctx.langs[0] ? props.help : undefined}
          placeholder={props.placeholder?.[lang]}
          lang={lang}
        />
      ))}
    </div>
  );
}

export function Select(props: { name: string; label: string; value: string; options: Array<[string, string]>; help?: Child }) {
  const id = props.name.replace(/[^a-zA-Z0-9]/g, '_');
  return (
    <div class="field">
      <label for={id}>{props.label}</label>
      <select id={id} name={props.name}>
        {props.options.map(([v, l]) => (
          <option value={v} selected={v === props.value}>
            {l}
          </option>
        ))}
      </select>
      {props.help && <p class="help">{props.help}</p>}
    </div>
  );
}

export function Checkbox(props: { name: string; label: Child; checked: boolean; value?: string }) {
  const id = `${props.name.replace(/[^a-zA-Z0-9]/g, '_')}_${props.value ?? '1'}`;
  return (
    <label class="check" for={id}>
      <input type="checkbox" id={id} name={props.name} value={props.value ?? '1'} checked={props.checked} /> {props.label}
    </label>
  );
}

/** Small submit buttons that change a list (add, remove, move) – they also save the form. */
export function OpButton({ op, label, kind, title }: { op: string; label: Child; kind?: 'danger' | 'quiet'; title?: string }) {
  return (
    <button type="submit" name="op" value={op} class={`btn small ${kind ?? 'quiet'}`} title={title} formnovalidate>
      {label}
    </button>
  );
}
