function escapePosixArg(arg: string): string {
  return `'${arg.replace(/'/g, `'\\''`)}'`
}

function formatShValue(val: unknown): string {
  if (val === null || val === undefined) {
    return `''`
  }
  if (Array.isArray(val)) {
    return val.map(formatShValue).join(' ')
  }
  return escapePosixArg(String(val))
}

export function sh(
  strings: TemplateStringsArray,
  ...values: readonly unknown[]
): string {
  let result = ''
  for (let i = 0; i < strings.length; i++) {
    result += strings[i]
    if (i < values.length) {
      result += formatShValue(values[i])
    }
  }
  return result
}
