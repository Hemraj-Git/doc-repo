import "server-only"
import { randomInt } from "node:crypto"

// No look-alike characters (0/O, 1/l/I) so passwords can be read out or copied by hand.
const LOWER = "abcdefghijkmnpqrstuvwxyz"
const UPPER = "ABCDEFGHJKLMNPQRSTUVWXYZ"
const DIGITS = "23456789"
const ALL = LOWER + UPPER + DIGITS

const pick = (chars: string) => chars[randomInt(chars.length)]

/** 12-character temporary password that satisfies the password policy. */
export function generateTempPassword() {
  const chars = [pick(LOWER), pick(UPPER), pick(DIGITS), ...Array.from({ length: 9 }, () => pick(ALL))]
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1)
    ;[chars[i], chars[j]] = [chars[j], chars[i]]
  }
  return chars.join("")
}
