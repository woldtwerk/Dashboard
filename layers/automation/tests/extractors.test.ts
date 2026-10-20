import { describe, expect, it } from 'vitest'
import {
  MAX_EXTRACT_INPUT_LENGTH,
  MAX_EXTRACT_PATTERN_LENGTH,
  extractActionError,
  extractLoginCode,
  extractWithRegex,
  isVariableName,
  modalEventResource,
  modalFromEvent,
  modalRef,
  parseModalRef,
  renderTemplate,
  templateVariables
} from '../shared/extractors'

describe('extractLoginCode', () => {
  it.each([
    ['GitHub', 'Hi, Your GitHub verification code is 123456. It expires in 10 minutes.', '123456'],
    ['Google', 'G-123456 is your Google verification code', 'G123456'],
    ['Microsoft', 'Use code 1234-5678 to sign in to your Microsoft account', '12345678'],
    ['netcup', 'Ihr netcup Sicherheitstoken lautet J4K9L2.', 'J4K9L2'],
    ['bank TAN', 'Ihre TAN für den Auftrag 4711 lautet 483920. Bitte geben Sie sie ein.', '483920'],
    ['space group', 'Your code is 482 913', '482913'],
    ['Bestätigungscode', 'Ihr Bestätigungscode: 654321', '654321'],
    ['Anmeldecode', 'Anmeldecode 9F8E7D — gültig für 5 Minuten.', '9F8E7D'],
    ['passcode', 'Your one-time passcode is 445566', '445566'],
    ['Einmalcode', 'Einmalcode: 112233', '112233'],
    ['Zugangscode', 'Zugangscode: 246810', '246810'],
    ['Sicherheitscode', 'Sicherheitscode 13579', '13579'],
    ['sign-in PIN', 'Your sign-in PIN is 4821', '4821'],
    ['One Time Password', 'Amazon: 839201 is your One Time Password', '839201'],
    ['HTML body', '<div><p>Your verification code is <b>998877</b></p></div>', '998877'],
    ['Verifizierungscode', 'Verifizierungscode: 55A66B', '55A66B'],
    ['code before keyword', '482913 ist Ihr Anmeldecode.', '482913'],
    ['hyphen', 'Your code is ABC-123', 'ABC123']
  ])('extracts the %s sample', (_name, text, expected) => {
    expect(extractLoginCode(text)).toBe(expected)
  })

  it('prefers the 6-digit code when several follow a keyword', () => {
    expect(extractLoginCode('Code 1234, your reference is 123456')).toBe('123456')
  })

  it('ignores a year that stands next to a month', () => {
    expect(extractLoginCode('Login required since January 2021 — details in the mail')).toBeUndefined()
  })

  it('ignores a bare year next to a keyword', () => {
    expect(extractLoginCode('Your account was created in 2019, please sign in again')).toBeUndefined()
  })

  it.each([
    ['invoice with order number and date', 'Rechnung Nr. 2024001234 vom 12.03.2024, Betrag 1.234,56 EUR. Vielen Dank für Ihren Einkauf.'],
    ['newsletter with a year', 'Our newsletter — January 2024 had our best offers. Unsubscribe anytime.'],
    ['order confirmation', 'Your order 12345678 has shipped on 2024-01-05 and will arrive soon.'],
    ['phone number', 'Call us at +49 30 1234567 for support, Monday to Friday.'],
    ['amount', 'Your balance is 12.345,67 EUR as of today.'],
    ['URL', 'Login at https://example.com/login/123456 to continue.'],
    ['time', 'Login at 14:30 today to confirm.'],
    ['long order id near a keyword', 'Verification code order 1234567890123 is not a code.'],
    ['no digits at all', 'Your security code is on its way. Did you know shipping is free?']
  ])('returns undefined for %s', (_name, text) => {
    expect(extractLoginCode(text)).toBeUndefined()
  })

  it('returns undefined for empty or non-code text', () => {
    expect(extractLoginCode('')).toBeUndefined()
    expect(extractLoginCode('Hello, this is a normal mail without any code.')).toBeUndefined()
  })

  it('extracts the only real code from an anonymised netcup security-token mail', () => {
    // Distractors: 'Sicherheitscode' in the first sentence with no code, a
    // 'Zwei-Faktor-Authentifizierungs-Token' with no code, '15 Minuten', '(CCP)'
    // and a helpcenter URL.
    const mail = `Guten Tag Max Mustermann,

Bitte verwenden Sie diesen einmaligen Sicherheitscode, um sich in Ihrem Kundenaccount anzumelden.

Ihr Sicherheitstoken: 048213
Bitte beachten Sie, dass dieser Token nur 15 Minuten gültig ist.

Der Grund für dieses zusätzliche Sicherheitsverfahren ist, dass Sie keinen Zwei-Faktor-Authentifizierungs-Token in Ihrem Konto hinterlegt haben.

Aktivieren Sie Zwei-Faktor-Authentisierung in Ihrem Customer Control Panel (CCP) um diese Bestätigungs-E-Mail in Zukunft zu vermeiden. Zwei-Faktor-Authentisierung bietet ein höheres Maß an Sicherheit, ist flexibler und lässt sich in wenigen Schritten einrichten: https://helpcenter.netcup.com/de/wiki/general/mfa/


Mit freundlichen Grüßen

Ihr netcup Team`

    expect(extractLoginCode(mail)).toBe('048213')
  })
})

describe('isVariableName', () => {
  it('accepts lower-case names with digits and underscores', () => {
    expect(isVariableName('code')).toBe(true)
    expect(isVariableName('login_code_2')).toBe(true)
    expect(isVariableName('a'.repeat(32))).toBe(true)
  })

  it('rejects names that could not be a template placeholder', () => {
    expect(isVariableName('Code')).toBe(false)
    expect(isVariableName('2fa')).toBe(false)
    expect(isVariableName('_code')).toBe(false)
    expect(isVariableName('login-code')).toBe(false)
    expect(isVariableName('')).toBe(false)
    expect(isVariableName('a'.repeat(33))).toBe(false)
  })
})

describe('renderTemplate', () => {
  it('replaces known variables and drops unknown ones', () => {
    expect(renderTemplate('Code {{code}} from {{from}} — {{nope}}', { code: '123456', from: 'GitHub' }))
      .toBe('Code 123456 from GitHub — ')
  })

  it('accepts whitespace inside the placeholder', () => {
    expect(renderTemplate('{{ code }}', { code: '482913' })).toBe('482913')
  })

  it('leaves text that is not a valid placeholder alone', () => {
    expect(renderTemplate('Total {{Total}}', { Total: 'x' })).toBe('Total {{Total}}')
  })

  it('lists the distinct template variables', () => {
    expect(templateVariables('{{code}} {{subject}} {{code}}')).toEqual(['code', 'subject'])
  })
})

describe('extractWithRegex', () => {
  it('takes the first capture group', () => {
    expect(extractWithRegex('order\\s+(\\d+)', 'Your order 4711 is ready')).toBe('4711')
  })

  it('falls back to the whole match without a capture group', () => {
    expect(extractWithRegex('\\d{6}', 'code 482913 please')).toBe('482913')
  })

  it('is case-insensitive', () => {
    expect(extractWithRegex('code: ([A-Z]+)', 'CODE: abcd')).toBe('abcd')
  })

  it('returns undefined without a match or for an unusable pattern', () => {
    expect(extractWithRegex('nope', 'nothing here')).toBeUndefined()
    expect(extractWithRegex('(', 'text')).toBeUndefined()
    expect(extractWithRegex('', 'text')).toBeUndefined()
    expect(extractWithRegex('x'.repeat(MAX_EXTRACT_PATTERN_LENGTH + 1), 'text')).toBeUndefined()
  })

  it('caps the input it matches', () => {
    const input = `${'x'.repeat(MAX_EXTRACT_INPUT_LENGTH)}482913`
    expect(extractWithRegex('(\\d{6})', input)).toBeUndefined()
  })
})

describe('extractActionError', () => {
  it('accepts a login-code extractor with a valid name', () => {
    expect(extractActionError({ variable: 'code', extractor: 'login-code' })).toBeUndefined()
  })

  it('rejects a bad variable name', () => {
    expect(extractActionError({ variable: 'Code', extractor: 'login-code' })).toContain('not a valid variable name')
  })

  it('requires a compilable regex with a bounded length', () => {
    expect(extractActionError({ variable: 'code', extractor: 'regex' })).toContain('needs a pattern')
    expect(extractActionError({ variable: 'code', extractor: 'regex', pattern: '(' })).toContain('not a valid regular expression')
    expect(extractActionError({ variable: 'code', extractor: 'regex', pattern: 'x'.repeat(MAX_EXTRACT_PATTERN_LENGTH + 1) }))
      .toContain(`at most ${MAX_EXTRACT_PATTERN_LENGTH}`)
    expect(extractActionError({ variable: 'code', extractor: 'regex', pattern: '(\\d+)' })).toBeUndefined()
  })
})

describe('modal references', () => {
  it('round-trips a run and node through the URL reference', () => {
    const ref = modalRef('run-42', 'notify-code')
    expect(ref).toBe('run-42.notify-code')
    expect(parseModalRef(ref)).toEqual({ runId: 'run-42', nodeId: 'notify-code' })
  })

  it('round-trips the domain-event resource', () => {
    const resource = modalEventResource('run-42', 'notify-code')
    expect(resource).toBe('run-42.notify-code')
    expect(modalFromEvent('modal', resource)).toEqual({ runId: 'run-42', nodeId: 'notify-code' })
  })

  it('accepts the legacy changed event with a modal: resource', () => {
    expect(modalFromEvent('changed', 'modal:run-42.notify-code')).toEqual({ runId: 'run-42', nodeId: 'notify-code' })
  })

  it('does not mistake another automation event for a modal', () => {
    expect(modalFromEvent('review', 'runs:review')).toBeUndefined()
    expect(modalFromEvent('changed', 'INBOX')).toBeUndefined()
    expect(modalFromEvent('modal', 'INBOX')).toBeUndefined()
    expect(modalFromEvent('modal', 'modal:')).toBeUndefined()
    expect(modalFromEvent('changed', 'modal:run-42')).toBeUndefined()
    expect(modalFromEvent('modal', undefined)).toBeUndefined()
  })

  it('rejects a malformed reference', () => {
    expect(parseModalRef(undefined)).toBeUndefined()
    expect(parseModalRef('')).toBeUndefined()
    expect(parseModalRef('.node')).toBeUndefined()
    expect(parseModalRef('run.')).toBeUndefined()
  })
})
