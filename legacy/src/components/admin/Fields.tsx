import ui from './ui.module.css'

/**
 * 폼 입력 프리미티브.
 *
 * 'use client' 를 붙이지 않았다 — 훅이 하나도 없어서 서버 컴포넌트로도, 클라이언트 폼 안에서도
 * 그대로 쓰인다. 라벨·설명·오류를 `aria-describedby` 로 묶는 배선을 한 곳에 모으는 것이 목적이다.
 */

function describedBy(id: string, hint: string | undefined, error: string | undefined): string | undefined {
  const ids = [hint ? `${id}-hint` : null, error ? `${id}-error` : null].filter(
    (v): v is string => v !== null
  )
  return ids.length > 0 ? ids.join(' ') : undefined
}

type Common = {
  name: string
  label: string
  id?: string
  hint?: string
  error?: string
  required?: boolean
  disabled?: boolean
}

function Label({ id, label, required }: { id: string; label: string; required?: boolean }) {
  return (
    <label className={ui.label} htmlFor={id}>
      {label}
      {required ? (
        <span className={ui.required} aria-hidden="true">
          *
        </span>
      ) : null}
    </label>
  )
}

function Hint({ id, hint }: { id: string; hint: string | undefined }) {
  return hint ? (
    <p className={ui.hint} id={`${id}-hint`}>
      {hint}
    </p>
  ) : null
}

function ErrorText({ id, error }: { id: string; error: string | undefined }) {
  return error ? (
    <p className={ui.error} id={`${id}-error`}>
      {error}
    </p>
  ) : null
}

export type TextFieldProps = Common & {
  defaultValue?: string
  type?: 'text' | 'email' | 'password'
  placeholder?: string
  maxLength?: number
  readOnly?: boolean
  mono?: boolean
  inputMode?: 'text' | 'numeric' | 'decimal'
  autoComplete?: string
  autoFocus?: boolean
  list?: string
}

export function TextField(props: TextFieldProps) {
  const id = props.id ?? `f-${props.name}`
  return (
    <div className={ui.field}>
      <Label id={id} label={props.label} required={props.required} />
      <Hint id={id} hint={props.hint} />
      <input
        className={`${ui.input}${props.mono ? ` ${ui.mono}` : ''}${props.error ? ` ${ui.inputError}` : ''}`}
        id={id}
        name={props.name}
        type={props.type ?? 'text'}
        defaultValue={props.defaultValue}
        placeholder={props.placeholder}
        maxLength={props.maxLength}
        readOnly={props.readOnly}
        disabled={props.disabled}
        required={props.required}
        inputMode={props.inputMode}
        autoComplete={props.autoComplete}
        autoFocus={props.autoFocus}
        list={props.list}
        aria-invalid={props.error ? true : undefined}
        aria-describedby={describedBy(id, props.hint, props.error)}
      />
      <ErrorText id={id} error={props.error} />
    </div>
  )
}

export type TextAreaFieldProps = Common & {
  defaultValue?: string
  rows?: number
  maxLength?: number
  placeholder?: string
}

export function TextAreaField(props: TextAreaFieldProps) {
  const id = props.id ?? `f-${props.name}`
  return (
    <div className={ui.field}>
      <Label id={id} label={props.label} required={props.required} />
      <Hint id={id} hint={props.hint} />
      <textarea
        className={`${ui.textarea}${props.error ? ` ${ui.inputError}` : ''}`}
        id={id}
        name={props.name}
        rows={props.rows ?? 5}
        defaultValue={props.defaultValue}
        maxLength={props.maxLength}
        placeholder={props.placeholder}
        disabled={props.disabled}
        required={props.required}
        aria-invalid={props.error ? true : undefined}
        aria-describedby={describedBy(id, props.hint, props.error)}
      />
      <ErrorText id={id} error={props.error} />
    </div>
  )
}

export type SelectFieldProps = Common & {
  defaultValue?: string
  options: readonly { value: string; label: string }[]
}

export function SelectField(props: SelectFieldProps) {
  const id = props.id ?? `f-${props.name}`
  return (
    <div className={ui.field}>
      <Label id={id} label={props.label} required={props.required} />
      <Hint id={id} hint={props.hint} />
      <select
        className={`${ui.select}${props.error ? ` ${ui.inputError}` : ''}`}
        id={id}
        name={props.name}
        defaultValue={props.defaultValue}
        disabled={props.disabled}
        aria-invalid={props.error ? true : undefined}
        aria-describedby={describedBy(id, props.hint, props.error)}
      >
        {props.options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <ErrorText id={id} error={props.error} />
    </div>
  )
}

export type ToggleFieldProps = Common & {
  defaultChecked?: boolean
}

/**
 * 체크박스는 꺼져 있으면 **전송 자체가 되지 않아** 서버에서 "안 보냄"과 "false"를 구별할 수 없다.
 * 같은 이름의 hidden `0` 을 앞에 두어 값이 항상 명시되게 한다 (뒤에 오는 체크박스가 이긴다).
 */
export function ToggleField(props: ToggleFieldProps) {
  const id = props.id ?? `f-${props.name}`
  return (
    <div className={ui.field}>
      <div className={ui.checkRow}>
        <input type="hidden" name={props.name} value="0" />
        <input
          type="checkbox"
          id={id}
          name={props.name}
          value="1"
          defaultChecked={props.defaultChecked}
          disabled={props.disabled}
          aria-describedby={describedBy(id, props.hint, props.error)}
        />
        <label htmlFor={id}>{props.label}</label>
      </div>
      <Hint id={id} hint={props.hint} />
      <ErrorText id={id} error={props.error} />
    </div>
  )
}
