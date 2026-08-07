import crypto from 'crypto';

const UPPERCASE = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const LOWERCASE = 'abcdefghijklmnopqrstuvwxyz';
const NUMBERS = '0123456789';
const SYMBOLS = '@#$%^&*';
const ALL = UPPERCASE + LOWERCASE + NUMBERS + SYMBOLS;

function pickRandom(set: string): string {
  return set[crypto.randomInt(set.length)];
}

function shuffle(str: string): string {
  const arr = str.split('');
  for (let i = arr.length - 1; i > 0; i--) {
    const j = crypto.randomInt(0, i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr.join('');
}

export function generateTempPassword(length: number = 12): string {
  if (length < 4) throw new Error('Minimum password length is 4');

  // Guarantee at least one from each set
  let result =
    pickRandom(UPPERCASE) +
    pickRandom(LOWERCASE) +
    pickRandom(NUMBERS) +
    pickRandom(SYMBOLS);

  // Fill remaining with random from all sets
  for (let i = result.length; i < length; i++) {
    result += pickRandom(ALL);
  }

  return shuffle(result);
}
