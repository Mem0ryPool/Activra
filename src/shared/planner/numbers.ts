/** Numbers written as digits, Chinese numerals or English words. */

const ZH_DIGITS: Record<string, number> = {
  零: 0,
  〇: 0,
  一: 1,
  二: 2,
  两: 2,
  俩: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9
}
const ZH_UNITS: Record<string, number> = { 十: 10, 百: 100, 千: 1000, 万: 10000 }

/** Regex source for one number in any supported form (no capture groups). */
export const ZH_NUMBER = '(?:\\d+|[零〇一二两俩三四五六七八九十百千万]+)'
export const EN_NUMBER_WORDS = [
  'a',
  'an',
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
  'ten',
  'eleven',
  'twelve',
  'thirteen',
  'fourteen',
  'fifteen',
  'sixteen',
  'seventeen',
  'eighteen',
  'nineteen',
  'twenty',
  'thirty',
  'forty',
  'fifty',
  'sixty',
  'seventy',
  'eighty',
  'ninety',
  'hundred'
]
const EN_VALUES: Record<string, number> = {
  a: 1,
  an: 1,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
  twenty: 20,
  thirty: 30,
  forty: 40,
  fifty: 50,
  sixty: 60,
  seventy: 70,
  eighty: 80,
  ninety: 90,
  hundred: 100
}
const TENS = 'twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety'
const ONES = 'one|two|three|four|five|six|seven|eight|nine'
/** Regex source for one English number: digits, a word, or "twenty-one". */
export const EN_NUMBER = `(?:\\d+|(?:${TENS})[- ](?:${ONES})|${[...EN_NUMBER_WORDS].sort((a, b) => b.length - a.length).join('|')})`

/** Parses Chinese numerals such as 二十, 三十五, 一百二十, 两, 十. Returns null if not a number. */
function parseZh(text: string): number | null {
  let total = 0
  let section = 0
  let digit: number | null = null
  for (const ch of text) {
    if (ch in ZH_DIGITS) {
      digit = ZH_DIGITS[ch] as number
    } else if (ch in ZH_UNITS) {
      const unit = ZH_UNITS[ch] as number
      if (unit === 10000) {
        total += (section + (digit ?? 0)) * unit
        section = 0
      } else {
        section += (digit ?? 1) * unit
      }
      digit = null
    } else {
      return null
    }
  }
  return total + section + (digit ?? 0)
}

/** Any supported number form → its value, or null. */
export function parseNumber(raw: string): number | null {
  const text = raw.trim().toLowerCase()
  if (!text) return null
  if (/^\d+$/.test(text)) return Number(text)
  const compound = /^([a-z]+)[- ]([a-z]+)$/.exec(text)
  if (compound && compound[1]! in EN_VALUES && compound[2]! in EN_VALUES) {
    return (EN_VALUES[compound[1]!] as number) + (EN_VALUES[compound[2]!] as number)
  }
  if (text in EN_VALUES) return EN_VALUES[text] as number
  // Digits followed by Chinese units are rare in plans; only plain numerals here.
  return parseZh(text)
}

/** "once" / "twice" / "thrice". */
export function parseTimesWord(word: string): number | null {
  const w = word.toLowerCase()
  return w === 'once' ? 1 : w === 'twice' ? 2 : w === 'thrice' ? 3 : null
}
